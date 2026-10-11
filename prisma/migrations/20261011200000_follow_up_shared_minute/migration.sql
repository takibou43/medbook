-- مشاركة الدقيقة المشغولة لموعد المتابعة الطبية من «خطط العلاج» (فوق PR #48): إضافي، آمن، وقابل لإعادة التطبيق.
-- لا DELETE، لا تغيير لأي قيمة موجودة، لا تغيير لأي وقت حجز. يعمل على ثلاث حالات للقاعدة ويصل بها كلها إلى الشكل نفسه:
--   (أ) إنتاج حاليًا: فيه slotSeq/doctorFollowUp/الفهرس الجديد/CHECK القديم (من مسودة PR #47) ولا يحوي isFollowUp بعد.
--   (ب) قاعدة بلا أي من ذلك.   (ج) قاعدة منشأة بـ prisma db push من المخطط الحالي (CI).

-- 1) أعمدة PR #48 (نفس تعريف ترحيله 20261011180000، مكرَّرة هنا ليصلح هذا الملف وحده) + أعمدة هذه الميزة.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "isFollowUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "followUpAnchorId" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "slotSeq" INTEGER NOT NULL DEFAULT 0;
-- مهجور (لا يقرؤه ولا يكتبه أي كود): يبقى حتى لا يضطر prisma db push إلى حذف عمود فيه قيم في الإنتاج.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "doctorFollowUp" BOOLEAN NOT NULL DEFAULT false;

-- 2) ملء isFollowUp للمواعيد المثبت أنها موعد عودة برمجه الطبيب (كما في #48؛ لا يلمس إلا isFollowUp، ويتكرر بأمان).
UPDATE "appointments" SET "isFollowUp" = true
WHERE "isFollowUp" = false AND "parentAppointmentId" IS NOT NULL AND "createdBy" = 'DOCTOR' AND "type" = 'FOLLOW_UP';

-- 3) القيد الفريد يشمل slotSeq بالاسم نفسه: يُنشأ الجديد قبل إسقاط القديم فلا توجد لحظة بلا حماية، ويُتخطى إن كان محدَّثًا.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'appointments'
      AND indexname = 'appointments_doctorId_date_startTime_activeSlot_key' AND indexdef LIKE '%slotSeq%'
  ) THEN
    CREATE UNIQUE INDEX "appointments_slotseq_swap_tmp"
      ON "appointments"("doctorId", "date", "startTime", "slotSeq", "activeSlot");
    DROP INDEX IF EXISTS "appointments_doctorId_date_startTime_activeSlot_key";
    ALTER INDEX "appointments_slotseq_swap_tmp" RENAME TO "appointments_doctorId_date_startTime_activeSlot_key";
  END IF;
END $$;

-- 4) الحارس: slotSeq > 0 لا يجوز إلا لموعد عودة من خطة علاج (isFollowUp وله treatmentPlanId).
--    يستبدل CHECK المسودة القديمة (كانت مبنية على doctorFollowUp). الحجز العادي لا يستطيع تجاوز الوقت المحجوز ولو بإدراج مباشر.
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_slot_seq_follow_up_chk";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_seq_follow_up_chk"
  CHECK ("slotSeq" >= 0 AND ("slotSeq" = 0 OR ("isFollowUp" = true AND "treatmentPlanId" IS NOT NULL)));
