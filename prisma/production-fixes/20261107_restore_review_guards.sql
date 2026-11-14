-- يعيد إلى الإنتاج حواجز التقييمات الموجودة في migrations/20260924170000_add_review_guards
-- والتي لم تُطبَّق على Neon (فحص 2026-10-26 و2026-11-07). آمن للتكرار.
-- جُرّب في 2026-11-07 على نسخة معزولة من الإنتاج (restore-test-20261107): 47 تقييمًا، 0 مخالفات، لا فقد بيانات.
-- لا يُنفَّذ على الإنتاج إلا بموافقة المالك وبعد نسخة احتياطية حديثة.
BEGIN;
DO $$ BEGIN
  -- الفحص مقيّد بالجدول public.reviews نفسه، لا باسم القيد وحده في أي جدول أو مخطط.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reviews'::regclass AND conname = 'reviews_rating_range') THEN
    ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reviews'::regclass AND conname = 'reviews_comment_length') THEN
    ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_comment_length" CHECK ("comment" IS NULL OR char_length("comment") <= 1000);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.reviews_prevent_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reviews are immutable (review %)', OLD."id" USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "reviews_immutable" ON "public"."reviews";
CREATE TRIGGER "reviews_immutable" BEFORE UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION public.reviews_prevent_update();
COMMIT;

-- الرجوع (rollback):
-- DROP TRIGGER IF EXISTS "reviews_immutable" ON "public"."reviews";
-- DROP FUNCTION IF EXISTS public.reviews_prevent_update();
-- ALTER TABLE "public"."reviews" DROP CONSTRAINT IF EXISTS "reviews_comment_length";
-- ALTER TABLE "public"."reviews" DROP CONSTRAINT IF EXISTS "reviews_rating_range";
