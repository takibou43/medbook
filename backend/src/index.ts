import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { Role, SubscriptionStatus } from "@prisma/client";
import { hashPassword } from "./utils/password";

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

Promise.all([grandfatherExistingDoctors(), bootstrapAdminUser()]).finally(() => {
  app.listen(env.port, () => {
    console.log(`🩺 MedBook API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
});
