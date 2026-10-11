-- تراجع عن توحيد التصميمين: العودة إلى حالة PR #47 (doctorFollowUp/slotSeq + الفهرس الخماسي) مع حفظ علامة العودة.
-- لا يفقد علامة موعد العودة: تُنسخ isFollowUp إلى doctorFollowUp قبل حذف عمودي تصميم #48.
BEGIN;
LOCK TABLE "appointments" IN SHARE ROW EXCLUSIVE MODE;
UPDATE "appointments" SET "doctorFollowUp" = true WHERE "isFollowUp" = true AND "doctorFollowUp" = false;
DO $$
DECLARE def text;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'appointments' AND indexname = 'appointments_doctorId_date_startTime_activeSlot_key';
  IF def IS NULL OR def NOT LIKE '%slotSeq%' THEN
    CREATE UNIQUE INDEX "appointments_rollback_swap_tmp" ON "appointments"("doctorId", "date", "startTime", "slotSeq", "activeSlot");
    DROP INDEX IF EXISTS "appointments_doctorId_date_startTime_activeSlot_key";
    ALTER INDEX "appointments_rollback_swap_tmp" RENAME TO "appointments_doctorId_date_startTime_activeSlot_key";
  END IF;
END $$;
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "followUpAnchorId";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "isFollowUp";
COMMIT;
