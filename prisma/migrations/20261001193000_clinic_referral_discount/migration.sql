ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "referralDiscountUntil" TIMESTAMP(3);
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "pendingReferralDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "doctor_referrals" ADD COLUMN IF NOT EXISTS "rewardClinicId" TEXT;
CREATE INDEX IF NOT EXISTS "doctor_referrals_rewardClinicId_idx" ON "doctor_referrals"("rewardClinicId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doctor_referrals_rewardClinicId_fkey' AND conrelid = 'doctor_referrals'::regclass) THEN
    ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_rewardClinicId_fkey"
      FOREIGN KEY ("rewardClinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinics_pendingReferralDays_check' AND conrelid = 'clinics'::regclass) THEN
    ALTER TABLE "clinics" ADD CONSTRAINT "clinics_pendingReferralDays_check" CHECK ("pendingReferralDays" >= 0);
  END IF;
END $$;
