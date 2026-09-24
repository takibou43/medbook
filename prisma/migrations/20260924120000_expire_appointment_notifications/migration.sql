-- ربط إشعارات الموعد بموعدها وانتهاؤها بانتهاء يوم الموعد (توقيت الجزائر).
-- إضافة بحتة: 3 أعمدة NULLable + فهرسان + مفتاح أجنبي. لا تعديل ولا حذف لأي بيانات موجودة؛
-- الإشعارات القديمة تبقى بلا ربط (NULL) فتُعامل كإشعارات عامة كما كانت. قابل لإعادة التطبيق.

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "appointmentDate" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "notifications_userId_expiresAt_idx" ON "notifications"("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "notifications_appointmentId_idx" ON "notifications"("appointmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_appointmentId_fkey') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
