-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('UNPAID', 'ACTIVE', 'EXPIRED');

-- AlterTable
ALTER TABLE "doctors" ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "doctors" ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3);

-- تثبيت الأطباء المسجَّلين قبل إضافة هذه الميزة على الحالة ACTIVE تلقائيًا، حتى لا
-- يختفوا فجأة من نتائج بحث المرضى ولا يُمنعوا من الحجوزات بمجرد تطبيق هذا التحديث.
-- كل طبيب جديد يسجّل بعد هذا التاريخ يبدأ افتراضيًا بحالة UNPAID (القيمة الافتراضية أعلاه).
UPDATE "doctors" SET "subscriptionStatus" = 'ACTIVE';
