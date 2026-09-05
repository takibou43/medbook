import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { SubscriptionStatus } from "@prisma/client";
import { sendDueReminders } from "./modules/appointments/appointments.service";

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

// تذكير SMS تلقائي للمرضى قبل موعدهم — انظر sendDueReminders في appointments.service.ts.
// لا توجد مهام مجدولة (cron) دائمة على الخطة المجانية لـ Render، لذا نستعمل مؤقّتًا داخل
// نفس عملية الخادم يتحقق كل 5 دقائق. يعمل طالما الخادم مستيقظ فقط.
const REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function startReminderJob() {
  setInterval(() => {
    sendDueReminders().catch((err) => console.error("فشل تشغيل مهمة التذكير التلقائي:", err));
  }, REMINDER_CHECK_INTERVAL_MS);
}

grandfatherExistingDoctors().finally(() => {
  app.listen(env.port, () => {
    console.log(`🩺 MedBook API listening on http://localhost:${env.port} (${env.nodeEnv})`);
    startReminderJob();
  });
});
