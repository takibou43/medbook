import { isKeepAwakeWindow } from "./lib/awakeWindow";
import { safeErrorCode } from "./lib/safeError";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { Role, SubscriptionStatus } from "@prisma/client";
import { hashPassword } from "./utils/password";
import { syncTrialSubscriptions } from "./lib/trial";
import { sweepStaleAppointmentsForAllDoctors } from "./modules/appointments/appointments.service";
import { runReminderCycle } from "./modules/reminders/reminders.service";
import { purgeExpiredNotifications } from "./modules/notifications/notifications.service";
import { adaptiveJob } from "./lib/adaptiveJob";
import { nextReminderDelay } from "./lib/backgroundTiming";
import { nextMaintenanceDelay } from "./lib/maintenanceTiming";
import { liveUpdates } from "./lib/liveUpdates";

const app = createApp();

// إصلاح تلقائي عند بدء التشغيل: الأطباء المسجَّلون قبل إضافة ميزة الاشتراك (2026-09-04)
// يُثبَّتون على ACTIVE إن لم يكونوا كذلك بالفعل. لجأنا لهذا لأن نشر المخطط الحي استخدم
// `prisma db push` وليس `migrate deploy`، فلم يُطبَّق تحديث الترحيل الأصلي (UPDATE ... ACTIVE)
// تلقائيًا، وبقي الطبيب الموجود مسبقًا على القيمة الافتراضية UNPAID عن طريق الخطأ.
// آمن للتكرار في كل إقلاع (idempotent): لا يغيّر إلا من كانت حالته UNPAID وتاريخ تسجيله سابقًا لتاريخ القطع.
const GRANDFATHER_CUTOFF = new Date("2026-09-04T00:00:00Z");

async function grandfatherExistingDoctors() {
  try {
    const result = await prisma.doctor.updateMany({
      where: { subscriptionStatus: SubscriptionStatus.UNPAID, createdAt: { lt: GRANDFATHER_CUTOFF } },
      data: { subscriptionStatus: SubscriptionStatus.ACTIVE },
    });
    if (result.count > 0) {
      console.log(`✅ Grandfathered ${result.count} pre-existing doctor(s) to ACTIVE subscription status.`);
    }
  } catch (err) {
    console.error("Failed to grandfather existing doctors:", safeErrorCode(err));
  }
}

// إنشاء حساب إدارة أوّلي عند أول إقلاع فقط — لا يوجد حاليًا أي حساب ADMIN في القاعدة الحية
// (لم يُشغَّل سكربت seed.ts عليها مطلقًا). البريد وكلمة المرور تُقرآن من متغيرات بيئة يضبطها
// المستخدم بنفسه في إعدادات Render (ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD) — لا
// نستعمل كلمة مرور ثابتة مكتوبة في الكود لأن هذا المستودع عام على GitHub. آمنة للتكرار:
// إن كان الحساب موجودًا مسبقًا بنفس البريد، أو لم تُضبط المتغيرات، لا تُنفَّذ أي عملية.
async function bootstrapAdminUser() {
  try {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!email || !password) return;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return;

    const passwordHash = await hashPassword(password);
    await prisma.user.create({ data: { email, passwordHash, role: Role.ADMIN } });
    console.log("✅ تم إنشاء حساب إدارة أولي.");
  } catch (err) {
    console.error("فشل إنشاء حساب الإدارة الأولي:", safeErrorCode(err));
  }
}

// إبقاء الخادم مستيقظًا: خطة الاستضافة المجانية تُنيم الخدمة بعد نحو 15 دقيقة بلا طلبات،
// فيصير أول فتح للموقع بعدها بطيئًا (قيسنا 24 ثانية). المهمة المجدولة في GitHub Actions
// لم تكفِ وحدها لأن GitHub يؤخّر الجداول القصيرة كثيرًا (قست الفواصل الفعلية: ساعتان إلى خمس).
// لذلك يطرق الخادم نفسه عبر عنوانه العام كل 10 دقائق فيبقى مستيقظًا، وتبقى مهمة GitHub
// احتياطيًا لإيقاظه إن نام فعلًا (فالنائم لا يستطيع طرق نفسه). RENDER_EXTERNAL_URL تضبطها منصة الاستضافة تلقائيًا.
const SELF_PING_INTERVAL_MS = 10 * 60 * 1000;

// يتوقف الإبقاء التلقائي مستيقظًا عند 18:00 بتوقيت الجزائر.
// زيارة المستخدم بعد ذلك تظل قادرة على إيقاظ الخادم.
function startSelfPing() {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) return;

  setInterval(() => {
    if (!isKeepAwakeWindow(new Date())) return;
    fetch(baseUrl + "/health").catch(() => undefined);
  }, SELF_PING_INTERVAL_MS);

  console.log(
    "⏰ الطرق الذاتي مفعّل: 07:30–18:00 يوميًا (توقيت الجزائر)."
  );
}

Promise.all([
  grandfatherExistingDoctors(),
  bootstrapAdminUser(),
]).finally(() => {
  // One serialized maintenance cycle. Quiet checks share an hourly window;
  // clinic closing, subscription expiry and notification expiry wake it sooner.
  const maintenanceJob = adaptiveJob(async () => {
    await syncTrialSubscriptions();
    await sweepStaleAppointmentsForAllDoctors();
    try {
      await purgeExpiredNotifications();
    } catch (err) {
      console.error("تعذّر حذف إشعارات المواعيد المنتهية:", safeErrorCode(err));
      throw err;
    }
  }, nextMaintenanceDelay);
  liveUpdates.subscribe(() => maintenanceJob.wake());

  // دقة الدقيقة قرب المواعيد؛ في الفترات الهادئة يتراجع الفحص مع استيقاظ فوري بعد أي تعديل.
  // الحالة كلها في قاعدة البيانات (AppointmentReminder)، فإعادة تشغيل الخادم لا تُضيع ولا تكرّر شيئًا:
  // الدورة التالية تكمل من حيث توقفت، والقيد الفريد + الحجز الذرّي يمنعان الإرسال المزدوج.
  if (env.reminders.enabled) {
    const intervalMs = Math.max(15_000, env.reminders.intervalMs || 60_000);
    const reminderJob = adaptiveJob(
      () => runReminderCycle(),
      () => nextReminderDelay(intervalMs),
      intervalMs,
    );
    liveUpdates.subscribe(() => reminderJob.wake());
  }

  startSelfPing();

  app.listen(env.port, () => {
    console.log(`🩺 MedBook API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
});
