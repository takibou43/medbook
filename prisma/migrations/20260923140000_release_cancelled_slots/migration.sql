-- تحرير أوقات المواعيد الملغاة دون حذف أي سجل.
-- قبل: قيد فريد (doctorId, date, startTime) يشمل كل الحالات → الموعد CANCELLED يحجز وقته إلى الأبد.
-- بعد: عمود activeSlot = true للموعد الذي يشغل وقته و NULL للملغى، والقيد الفريد يشمله.
-- NULL لا يتعارض في PostgreSQL، فيُسمح بحجز جديد مكان الملغى، ويبقى منع موعدين نشطين في نفس الوقت.
-- قابل لإعادة التطبيق (idempotent). لا DELETE، ولا تغيير لأي عمود موجود (الحالة/الوقت/الطبيب/المريض كما هي).

-- 1) العمود الجديد (كل الصفوف الحالية true افتراضيًا).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "activeSlot" BOOLEAN DEFAULT true;

-- 2) الملغاة فقط تُحرِّر وقتها. لا يلمس إلا العمود الجديد.
UPDATE "appointments" SET "activeSlot" = NULL WHERE "status" = 'CANCELLED' AND "activeSlot" IS NOT NULL;

-- 3) القيد الفريد الجديد (يُنشأ قبل إسقاط القديم فلا توجد لحظة بلا حماية).
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_doctorId_date_startTime_activeSlot_key"
  ON "appointments"("doctorId", "date", "startTime", "activeSlot");

-- 4) إسقاط القيد القديم الذي كان يحجز وقت الملغى.
DROP INDEX IF EXISTS "appointments_doctorId_date_startTime_key";

-- 5) حارس على مستوى قاعدة البيانات: أي تغيير للحالة (من أي مسار، حتى SQL مباشر) يضبط activeSlot.
--    CANCELLED → NULL (يحرّر الوقت)، أي حالة أخرى → true (يشغل الوقت ويخضع للقيد الفريد).
CREATE OR REPLACE FUNCTION appointments_sync_active_slot() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'CANCELLED' THEN
    NEW."activeSlot" := NULL;
  ELSE
    NEW."activeSlot" := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_sync_active_slot ON "appointments";
CREATE TRIGGER appointments_sync_active_slot
  BEFORE INSERT OR UPDATE OF "status" ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION appointments_sync_active_slot();
