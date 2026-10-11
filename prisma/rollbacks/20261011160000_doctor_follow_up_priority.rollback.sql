-- تراجع عن 20261011160000_doctor_follow_up_priority. شرط: لا توجد صفوف slotSeq > 0 (وإلا يفشل إنشاء القيد القديم، وهذا مقصود: لا فقدان بيانات صامت).
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_slot_seq_follow_up_chk";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'appointments'
             AND indexname = 'appointments_doctorId_date_startTime_activeSlot_key' AND indexdef LIKE '%slotSeq%') THEN
    CREATE UNIQUE INDEX "appointments_slotseq_swap_tmp" ON "appointments"("doctorId", "date", "startTime", "activeSlot");
    DROP INDEX "appointments_doctorId_date_startTime_activeSlot_key";
    ALTER INDEX "appointments_slotseq_swap_tmp" RENAME TO "appointments_doctorId_date_startTime_activeSlot_key";
  END IF;
END $$;
-- العمودان يُتركان (إضافيان وغير ضارين)؛ لإسقاطهما: ALTER TABLE "appointments" DROP COLUMN "slotSeq", DROP COLUMN "doctorFollowUp";
