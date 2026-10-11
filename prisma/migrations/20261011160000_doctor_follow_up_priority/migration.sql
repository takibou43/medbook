-- موعد المتابعة الطبية من «خطط العلاج»: أولوية + تمثيل داخلي (slotSeq) يسمح بمتابعة في دقيقة مشغولة
-- دون تعديل أي موعد موجود ودون تخزين ثوانٍ في startTime (النص "HH:mm" تعتمد عليه كل الأنظمة القديمة).
-- إضافي وآمن وقابل لإعادة التطبيق: لا DELETE، لا تغيير لقيم موجودة، كل الصفوف الحالية doctorFollowUp=false و slotSeq=0.

-- 1) عمودان جديدان بقيم افتراضية (لا يلمسان بيانات قديمة).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "doctorFollowUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "slotSeq" INTEGER NOT NULL DEFAULT 0;

-- 2) استبدال القيد الفريد بنسخة تشمل slotSeq وبالاسم نفسه، داخل عبارة واحدة (ذرّية):
--    يُنشأ الجديد قبل إسقاط القديم فلا توجد لحظة بلا حماية. تُتخطى إن كان القيد محدَّثًا من قبل.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'appointments'
      AND indexname = 'appointments_doctorId_date_startTime_activeSlot_key'
      AND indexdef LIKE '%slotSeq%'
  ) THEN
    CREATE UNIQUE INDEX "appointments_slotseq_swap_tmp"
      ON "appointments"("doctorId", "date", "startTime", "slotSeq", "activeSlot");
    DROP INDEX IF EXISTS "appointments_doctorId_date_startTime_activeSlot_key";
    ALTER INDEX "appointments_slotseq_swap_tmp" RENAME TO "appointments_doctorId_date_startTime_activeSlot_key";
  END IF;
END $$;

-- 3) حارس: slotSeq > 0 لا يجوز إلا لموعد متابعة الطبيب — الحجز العادي لا يستطيع تجاوز الوقت المحجوز ولو بإدراج مباشر.
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_slot_seq_follow_up_chk";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_seq_follow_up_chk"
  CHECK ("slotSeq" >= 0 AND ("slotSeq" = 0 OR "doctorFollowUp" = true));
