-- تراجع عن 20261011200000_follow_up_shared_minute. يرفض إن وُجد موعد يشارك دقيقة (slotSeq > 0) حتى لا تضيع بيانات.
-- لا يحذف isFollowUp/followUpAnchorId (تخص PR #48) ولا doctorFollowUp.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "appointments" WHERE "slotSeq" <> 0) THEN
    RAISE EXCEPTION 'يوجد مواعيد متابعة تشارك دقيقة (slotSeq > 0): عالجها يدويًا قبل التراجع';
  END IF;
END $$;
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_slot_seq_follow_up_chk";
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_old_unique_tmp" ON "appointments"("doctorId", "date", "startTime", "activeSlot");
DROP INDEX IF EXISTS "appointments_doctorId_date_startTime_activeSlot_key";
ALTER INDEX "appointments_old_unique_tmp" RENAME TO "appointments_doctorId_date_startTime_activeSlot_key";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "slotSeq";
