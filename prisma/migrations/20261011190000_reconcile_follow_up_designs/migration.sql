-- توحيد تصميمي موعد العودة (PR #47: doctorFollowUp/slotSeq، PR #48: isFollowUp/followUpAnchorId) دون فقدان بيانات.
--
-- الوضع المرصود في الإنتاج (قراءة فقط): العمودان doctorFollowUp وslotSeq موجودان بقيم افتراضية (0 صفًا true، 0 صفًا slotSeq>0)،
-- والفهرس الفريد يشمل slotSeq، وقيد CHECK appointments_slot_seq_follow_up_chk موجود.
--
-- مبادئ الأمان:
--  * لا حذف لأي عمود أو صف: العمودان القديمان يبقيان (مهملان) في المخطط كي لا يطلب prisma db push حذفهما.
--  * إيقاف كامل (RAISE EXCEPTION ثم تراجع المعاملة) إن وُجد أي صف slotSeq > 0، لأن ذلك يعني حجزين نشطين في دقيقة واحدة
--    لا يمكن تمثيلهما بتصميم #48 (الوقت فريد) — يتطلب قرارًا بشريًا.
--  * قابلة لإعادة التنفيذ: كل خطوة تتحقق من الحالة أولًا.
--  * معاملة واحدة مع قفل مشاركة على appointments أثناء التنفيذ (القراءة تستمر، والكتابة تنتظر لحظات).
BEGIN;
LOCK TABLE "appointments" IN SHARE ROW EXCLUSIVE MODE;

-- 1) الأعمدة (إضافة فقط، IF NOT EXISTS).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "doctorFollowUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "slotSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "isFollowUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "followUpAnchorId" TEXT;

-- 2) حارس: حالة غير متوقعة ⇒ إيقاف دون أي تعديل.
DO $$
DECLARE shared_minutes integer;
BEGIN
  SELECT count(*) INTO shared_minutes FROM "appointments" WHERE "slotSeq" > 0;
  IF shared_minutes > 0 THEN
    RAISE EXCEPTION 'reconcile aborted: % appointment(s) have slotSeq > 0 (share a minute). Manual review required; nothing was changed.', shared_minutes;
  END IF;
END $$;

-- 3) تحويل البيانات إلى تصميم #48 (علامة فقط؛ لا يُمَس الوقت ولا الحالة ولا أي عمود آخر).
UPDATE "appointments" SET "isFollowUp" = true WHERE "isFollowUp" = false AND "doctorFollowUp" = true;
UPDATE "appointments" SET "isFollowUp" = true
WHERE "isFollowUp" = false AND "parentAppointmentId" IS NOT NULL AND "createdBy" = 'DOCTOR' AND "type" = 'FOLLOW_UP';

-- 4) الفهرس الفريد: العودة إلى (doctorId, date, startTime, activeSlot) — منع الحجزين النشطين في الوقت نفسه.
--    ينشأ الجديد قبل إسقاط القديم فلا توجد لحظة بلا حماية. يُتخطى إن كان الفهرس سليمًا من قبل.
DO $$
DECLARE
  idx text := 'appointments_doctorId_date_startTime_activeSlot_key';
  def text;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'appointments' AND indexname = idx;
  IF def IS NULL OR def LIKE '%slotSeq%' THEN
    CREATE UNIQUE INDEX "appointments_reconcile_swap_tmp" ON "appointments"("doctorId", "date", "startTime", "activeSlot");
    DROP INDEX IF EXISTS "appointments_doctorId_date_startTime_activeSlot_key";
    ALTER INDEX "appointments_reconcile_swap_tmp" RENAME TO "appointments_doctorId_date_startTime_activeSlot_key";
  END IF;
END $$;

-- ملاحظة: قيد CHECK appointments_slot_seq_follow_up_chk (إن وُجد) يبقى كما هو؛ لا أثر له لأن slotSeq = 0 دائمًا.
COMMIT;
