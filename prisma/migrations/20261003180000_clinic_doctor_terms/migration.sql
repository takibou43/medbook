-- شروط الأسعار ونسب الأطباء داخل العيادات + لقطة مالية على المواعيد.
-- إضافي فقط: جدولان جديدان وأعمدة قابلة للإفراغ، بلا حذف أو تعديل لأي بيانات موجودة.
-- الأطباء الحاليون لا يُنشأ لهم سجل: يبقى سعرهم consultationFee ونسبتهم «غير محددة» حتى يضبطها المدير.
-- المواعيد الحالية تبقى بلا لقطة (لا صف في appointment_financials) ولا يُحسب لها نصيب.
--
-- قابل لإعادة التطبيق (idempotent) وآمن قبل نشر الشيفرة أو بعده: الإنتاج يشغّل `prisma db push` عند كل بدء،
-- وهو ينشئ الجداول والأعمدة لكنه لا ينشئ قيود CHECK. لذلك كل خطوة هنا محروسة، وقيود CHECK تُضاف
-- منفصلة إن لم تكن موجودة، فيعمل الملف سواء سبق db push أو تلاه.
-- يُنفَّذ بمعاملة واحدة:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql

-- 1) شروط كل طبيب مع عيادته (صف واحد لكل طبيب).
CREATE TABLE IF NOT EXISTS "clinic_doctor_terms" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "appointmentPriceDzd" INTEGER,
  "doctorSharePercent" INTEGER,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clinic_doctor_terms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_doctor_terms_doctorId_key" ON "clinic_doctor_terms"("doctorId");
CREATE INDEX IF NOT EXISTS "clinic_doctor_terms_clinicId_idx" ON "clinic_doctor_terms"("clinicId");

-- 2) شروط اختيارية على الدعوة وطلب الانتقال (تُطبَّق عند القبول/الموافقة).
ALTER TABLE "clinic_doctor_invites"
  ADD COLUMN IF NOT EXISTS "termsPriceDzd" INTEGER,
  ADD COLUMN IF NOT EXISTS "termsDoctorSharePercent" INTEGER;
ALTER TABLE "clinic_transfer_requests"
  ADD COLUMN IF NOT EXISTS "termsPriceDzd" INTEGER,
  ADD COLUMN IF NOT EXISTS "termsDoctorSharePercent" INTEGER;

-- 3) اللقطة المالية للموعد (جدول منفصل حتى لا تظهر النسبة في استجابات الموعد العادية).
CREATE TABLE IF NOT EXISTS "appointment_financials" (
  "appointmentId" TEXT NOT NULL,
  "priceDzd" INTEGER,
  "doctorSharePercent" INTEGER,
  "clinicId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appointment_financials_pkey" PRIMARY KEY ("appointmentId")
);
CREATE INDEX IF NOT EXISTS "appointment_financials_clinicId_idx" ON "appointment_financials"("clinicId");

-- 4) المفاتيح الأجنبية وقيود CHECK (كل قيد يُضاف إن لم يوجد).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_doctor_terms_clinicId_fkey') THEN
    ALTER TABLE "clinic_doctor_terms" ADD CONSTRAINT "clinic_doctor_terms_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_doctor_terms_doctorId_fkey') THEN
    ALTER TABLE "clinic_doctor_terms" ADD CONSTRAINT "clinic_doctor_terms_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_financials_appointmentId_fkey') THEN
    ALTER TABLE "appointment_financials" ADD CONSTRAINT "appointment_financials_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_doctor_terms_price_nonneg') THEN
    ALTER TABLE "clinic_doctor_terms" ADD CONSTRAINT "clinic_doctor_terms_price_nonneg" CHECK ("appointmentPriceDzd" IS NULL OR "appointmentPriceDzd" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_doctor_terms_share_range') THEN
    ALTER TABLE "clinic_doctor_terms" ADD CONSTRAINT "clinic_doctor_terms_share_range" CHECK ("doctorSharePercent" IS NULL OR ("doctorSharePercent" >= 0 AND "doctorSharePercent" <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_doctor_invites_terms_check') THEN
    ALTER TABLE "clinic_doctor_invites" ADD CONSTRAINT "clinic_doctor_invites_terms_check" CHECK (
      ("termsPriceDzd" IS NULL OR "termsPriceDzd" >= 0) AND
      ("termsDoctorSharePercent" IS NULL OR ("termsDoctorSharePercent" >= 0 AND "termsDoctorSharePercent" <= 100)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_transfer_requests_terms_check') THEN
    ALTER TABLE "clinic_transfer_requests" ADD CONSTRAINT "clinic_transfer_requests_terms_check" CHECK (
      ("termsPriceDzd" IS NULL OR "termsPriceDzd" >= 0) AND
      ("termsDoctorSharePercent" IS NULL OR ("termsDoctorSharePercent" >= 0 AND "termsDoctorSharePercent" <= 100)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_financials_price_nonneg') THEN
    ALTER TABLE "appointment_financials" ADD CONSTRAINT "appointment_financials_price_nonneg" CHECK ("priceDzd" IS NULL OR "priceDzd" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_financials_share_range') THEN
    ALTER TABLE "appointment_financials" ADD CONSTRAINT "appointment_financials_share_range" CHECK ("doctorSharePercent" IS NULL OR ("doctorSharePercent" >= 0 AND "doctorSharePercent" <= 100));
  END IF;
END $$;
