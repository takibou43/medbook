-- حماية تقييمات الأطباء (جدول reviews الموجود — لا جدول جديد). إضافة بحتة وقابلة لإعادة التطبيق:
-- لا حذف ولا تعديل لأي بيانات موجودة.
--   1) فهرس patientId (مواعيد المريض + تقييماته).
--   2) قيد CHECK: التقييم من 1 إلى 5 فقط، وطول التعليق ≤ 1000 (خط دفاع أخير بعد Zod والخدمة).
--   3) trigger يمنع أي UPDATE على التقييم بعد إنشائه (لا تعديل من الطبيب ولا من غيره). الحذف (إشراف
--      الإدارة) يبقى ممكنًا. قيد appointmentId الفريد الموجود أصلًا يضمن تقييمًا واحدًا لكل موعد.
-- ملاحظة: الإنتاج يطبّق المخطط بـ `prisma db push` الذي ينشئ الفهرس (1) وحده؛ القيد (2) والـtrigger (3)
-- لا يديرهما Prisma فيجب تطبيق هذا الملف يدويًا على قاعدة الإنتاج (idempotent).

CREATE INDEX IF NOT EXISTS "reviews_patientId_idx" ON "reviews"("patientId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_rating_range') THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_comment_length') THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_comment_length" CHECK ("comment" IS NULL OR char_length("comment") <= 1000);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION reviews_prevent_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reviews are immutable (review %)', OLD."id" USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "reviews_immutable" ON "reviews";
CREATE TRIGGER "reviews_immutable" BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION reviews_prevent_update();
