import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { Role, SubscriptionStatus } from "@prisma/client";
import { hashPassword } from "./utils/password";
import { syncTrialSubscriptions } from "./lib/trial";

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
    console.error("Failed to grandfather existing doctors:", err);
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
    console.log(`✅ تم إنشاء حساب إدارة أولي: ${email}`);
  } catch (err) {
    console.error("فشل إنشاء حساب الإدارة الأولي:", err);
  }
}

// مزامنة فترة التجربة المجانية: عند الإقلاع ثم كل خمس دقائق، حتى يُفتح الاشتراك تلقائيًا للطبيب
// الذي سجّل لتوّه دون انتظار تدخلك، وحتى تتوقف الاشتراكات وحدها لحظة انتهاء التجربة.
const TRIAL_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// إبقاء الخادم مستيقظًا: خطة الاستضافة المجانية تُنيم الخدمة بعد نحو 15 دقيقة بلا طلبات،
// فيصير أول فتح للموقع بعدها بطيئًا (قيسنا 24 ثانية). المهمة المجدولة في GitHub Actions
// لم تكفِ وحدها لأن GitHub يؤخّر الجداول القصيرة كثيرًا (قست الفواصل الفعلية: ساعتان إلى خمس).
// لذلك يطرق الخادم نفسه عبر عنوانه العام كل 10 دقائق فيبقى مستيقظًا، وتبقى مهمة GitHub
// احتياطيًا لإيقاظه إن نام فعلًا (فالنائم لا يستطيع طرق نفسه). RENDER_EXTERNAL_URL تضبطها منصة الاستضافة تلقائيًا.
const SELF_PING_INTERVAL_MS = 10 * 60 * 1000;

// نافذة الإبقاء مستيقظًا بتوقيت الجزائر (UTC+1 بلا توقيت صيفي): من الخامسة صباحًا حتى منتصف الليل.
// السبب: الخطة المجانية تمنح 750 ساعة تشغيل شهريًا لكامل مساحة العمل، وإبقاؤه مستيقظًا 24/24
// يستهلك 744 ساعة في الشهر ذي 31 يومًا — هامش 6 ساعات فقط، وتجاوزه يوقف الخدمة إلى بداية الشهر التالي.
// بهذه النافذة (19 ساعة يوميًا) ينخفض الاستهلاك إلى نحو 589 ساعة، مع بقاء الموقع سريعًا طوال ساعات العيادة.
// من يفتح الموقع ليلًا يوقظ الخادم بنفسه (مع انتظار أول طلب قرابة 40 ثانية، والمهلة 45).
const AWAKE_FROM_HOUR = 5;
// يوم الجمعة: العيادات مغلقة صباحًا، فلا داعي لإبقاء الخادم مستيقظًا — يبدأ من الخامسة مساءً.
const FRIDAY_AWAKE_FROM_HOUR = 17;
const FRIDAY = 5; // 0 = الأحد وفق ترقيم JavaScript
const ALGERIA_UTC_OFFSET_MS = 60 * 60 * 1000;

// وقت الجزائر الآن كـDate مزاحة، حتى نقرأ اليوم والساعة من مرجع واحد متسق: لو قرأنا اليوم
// بتوقيت UTC والساعة بتوقيت الجزائر لاختلفا بين الساعة 23:00 ومنتصف الليل بتوقيت UTC.
function algeriaNow(): Date {
  return new Date(Date.now() + ALGERIA_UTC_OFFSET_MS);
}

function startSelfPing() {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) return;

  setInterval(() => {
    const now = algeriaNow();
    const startHour = now.getUTCDay() === FRIDAY ? FRIDAY_AWAKE_FROM_HOUR : AWAKE_FROM_HOUR;
    // النافذة تمتد دائمًا حتى منتصف الليل، فيكفي التحقق من بدايتها.
    if (now.getUTCHours() < startHour) return;
    fetch(baseUrl + "/health").catch(() => undefined);
  }, SELF_PING_INTERVAL_MS);

  console.log(
    "⏰ الطرق الذاتي مفعّل: من " + AWAKE_FROM_HOUR + ":00 حتى منتصف الليل، ومن " + FRIDAY_AWAKE_FROM_HOUR + ":00 يوم الجمعة (توقيت الجزائر)."
  );
}

Promise.all([grandfatherExistingDoctors(), bootstrapAdminUser(), syncTrialSubscriptions()]).finally(() => {
  setInterval(() => {
    void syncTrialSubscriptions();
  }, TRIAL_SYNC_INTERVAL_MS);

  startSelfPing();

  app.listen(env.port, () => {
    console.log(`🩺 MedBook API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
});
