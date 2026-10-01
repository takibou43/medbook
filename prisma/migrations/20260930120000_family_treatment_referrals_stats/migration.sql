-- الحساب العائلي + خطط علاج الأسنان + موعد العودة الذي يبرمجه الطبيب + إحالة الأطباء + فهرس إحصائية الحجوزات.
--
-- إضافة بحتة: جداول وأعمدة وفهارس جديدة فقط. لا DROP لأي عمود، ولا DELETE لأي بيانات، ولا تغيير لنوع عمود موجود.
-- قابل لإعادة التطبيق (IF NOT EXISTS / DO $$ ... $$) حتى لا يفشل إن سبقه `prisma db push` جزئيًا.
--
-- ⚠️ الإنتاج يطبّق المخطط بـ `prisma db push` عند الإقلاع (backend/package.json → start). db push وحده:
--   - يضيف "createdBy" بقيمة PATIENT لكل الصفوف القديمة (بما فيها حجوزات الضيوف) — الخطوة 3 أدناه تصحّحها إلى GUEST.
--   - لا ينشئ الـtrigger في الخطوة 9.
-- لذلك يُنصح بتطبيق هذا الملف يدويًا على القاعدة (بعد نسخة احتياطية) قبل نشر الكود الجديد.

-- 1) الأنواع الجديدة
DO $$ BEGIN
  CREATE TYPE "AppointmentCreatedBy" AS ENUM ('PATIENT', 'DOCTOR', 'ADMIN', 'GUEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "FamilyRelationship" AS ENUM ('CHILD', 'SPOUSE', 'PARENT', 'SIBLING', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "TreatmentPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "TreatmentSessionStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "DentalFollowUpStatus" AS ENUM ('DUE', 'SCHEDULED', 'COMPLETED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "DoctorReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) أفراد العائلة
CREATE TABLE IF NOT EXISTS "family_members" (
    "id" TEXT NOT NULL,
    "ownerPatientId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "gender" "Gender",
    "relationship" "FamilyRelationship" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "family_members_ownerPatientId_idx" ON "family_members"("ownerPatientId");

-- 3) أعمدة الموعد الجديدة (كلها اختيارية أو بقيمة افتراضية؛ لا يتغيّر أي عمود موجود)
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "familyMemberId" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "parentAppointmentId" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "treatmentPlanId" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "treatmentSessionId" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "createdBy" "AppointmentCreatedBy" NOT NULL DEFAULT 'PATIENT';
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
-- حجوزات الضيوف القديمة (بلا حساب) مصدرها GUEST. يلمس العمود الجديد وحده، ولا يلمس إلا الصفوف التي لم يُكتب فيها مصدر آخر.
UPDATE "appointments" SET "createdBy" = 'GUEST' WHERE "patientId" IS NULL AND "createdBy" = 'PATIENT' AND "createdByUserId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "appointments_doctorId_idempotencyKey_key" ON "appointments"("doctorId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "appointments_familyMemberId_idx" ON "appointments"("familyMemberId");
CREATE INDEX IF NOT EXISTS "appointments_parentAppointmentId_idx" ON "appointments"("parentAppointmentId");
CREATE INDEX IF NOT EXISTS "appointments_createdAt_status_idx" ON "appointments"("createdAt", "status");

-- 4) كود إحالة الطبيب
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "doctors_referralCode_key" ON "doctors"("referralCode");

-- 5) خطط علاج الأسنان
CREATE TABLE IF NOT EXISTS "dental_treatment_plans" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "familyMemberId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TreatmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "estimatedSessions" INTEGER,
    "estimatedTotalCost" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_treatment_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dental_treatment_plans_doctorId_idx" ON "dental_treatment_plans"("doctorId");
CREATE INDEX IF NOT EXISTS "dental_treatment_plans_patientId_idx" ON "dental_treatment_plans"("patientId");
CREATE INDEX IF NOT EXISTS "dental_treatment_plans_familyMemberId_idx" ON "dental_treatment_plans"("familyMemberId");

CREATE TABLE IF NOT EXISTS "dental_treatment_sessions" (
    "id" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "sessionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "plannedDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "TreatmentSessionStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_treatment_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dental_treatment_sessions_appointmentId_key" ON "dental_treatment_sessions"("appointmentId");
CREATE INDEX IF NOT EXISTS "dental_treatment_sessions_treatmentPlanId_idx" ON "dental_treatment_sessions"("treatmentPlanId");

CREATE TABLE IF NOT EXISTS "dental_follow_ups" (
    "id" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "DentalFollowUpStatus" NOT NULL DEFAULT 'DUE',
    "appointmentId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_follow_ups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dental_follow_ups_appointmentId_key" ON "dental_follow_ups"("appointmentId");
CREATE INDEX IF NOT EXISTS "dental_follow_ups_treatmentPlanId_dueDate_idx" ON "dental_follow_ups"("treatmentPlanId", "dueDate");

-- 6) إحالات الأطباء
CREATE TABLE IF NOT EXISTS "doctor_referrals" (
    "id" TEXT NOT NULL,
    "referrerDoctorId" TEXT NOT NULL,
    "referredDoctorId" TEXT NOT NULL,
    "referralCodeUsed" TEXT NOT NULL,
    "status" "DoctorReferralStatus" NOT NULL DEFAULT 'PENDING',
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "rewardDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "doctor_referrals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_referrals_referredDoctorId_key" ON "doctor_referrals"("referredDoctorId");
CREATE INDEX IF NOT EXISTS "doctor_referrals_referrerDoctorId_idx" ON "doctor_referrals"("referrerDoctorId");

-- 7) المفاتيح الأجنبية. RESTRICT على بيانات الأسرة والعلاج (لا حذف متسلسل لتاريخ طبي)،
--    SET NULL على الروابط الاختيارية بين موعد وآخر/جلسة/خطة (حذف طرف لا يحذف الآخر)،
--    CASCADE على الإحالة فقط (ليست بيانات طبية، والأثر محفوظ في audit_logs).
DO $$ BEGIN
  ALTER TABLE "family_members" ADD CONSTRAINT "family_members_ownerPatientId_fkey" FOREIGN KEY ("ownerPatientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_parentAppointmentId_fkey" FOREIGN KEY ("parentAppointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "dental_treatment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_treatmentSessionId_fkey" FOREIGN KEY ("treatmentSessionId") REFERENCES "dental_treatment_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dental_treatment_sessions" ADD CONSTRAINT "dental_treatment_sessions_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "dental_treatment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dental_treatment_sessions" ADD CONSTRAINT "dental_treatment_sessions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dental_follow_ups" ADD CONSTRAINT "dental_follow_ups_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "dental_treatment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dental_follow_ups" ADD CONSTRAINT "dental_follow_ups_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_referrerDoctorId_fkey" FOREIGN KEY ("referrerDoctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_referredDoctorId_fkey" FOREIGN KEY ("referredDoctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 8) قيود CHECK دفاعية (خط أخير بعد Zod والخدمة).
DO $$ BEGIN
  ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_not_self" CHECK ("referrerDoctorId" <> "referredDoctorId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_reward_days" CHECK ("rewardDays" = 30);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_cost_nonneg" CHECK ("estimatedTotalCost" IS NULL OR "estimatedTotalCost" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 9) حارس على مستوى قاعدة البيانات: إلغاء موعد عودة (من أي مسار: المريض، الطبيب، عطلة، إدارة) يعيد
--    المتابعة المرتبطة به إلى DUE بدل حذفها. نفس المنطق مطبّق أيضًا في الخادم (syncDentalFollowUps)،
--    وهذا الـtrigger طبقة ثانية لما يُكتب خارج الخادم.
CREATE OR REPLACE FUNCTION appointments_release_dental_follow_up() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'CANCELLED' AND OLD."status" IS DISTINCT FROM 'CANCELLED' THEN
    UPDATE "dental_follow_ups"
       SET "status" = 'DUE', "appointmentId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "appointmentId" = NEW."id" AND "status" = 'SCHEDULED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_release_dental_follow_up ON "appointments";
CREATE TRIGGER appointments_release_dental_follow_up
  AFTER UPDATE OF "status" ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION appointments_release_dental_follow_up();
