-- Candidate baseline: final SQL guards only. No historical data backfills.
-- Not an approved migration path for an existing production database.
BEGIN;

-- Source: 20260923140000_release_cancelled_slots

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

CREATE TRIGGER appointments_sync_active_slot
  BEFORE INSERT OR UPDATE OF "status" ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION appointments_sync_active_slot();

-- Source: 20260924170000_add_review_guards

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_comment_length" CHECK ("comment" IS NULL OR char_length("comment") <= 1000);

CREATE OR REPLACE FUNCTION reviews_prevent_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reviews are immutable (review %)', OLD."id" USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reviews_immutable" BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION reviews_prevent_update();

-- Source: 20260930120000_family_treatment_referrals_stats

ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_not_self" CHECK ("referrerDoctorId" <> "referredDoctorId");

ALTER TABLE "doctor_referrals" ADD CONSTRAINT "doctor_referrals_reward_days" CHECK ("rewardDays" = 30);

ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_cost_nonneg" CHECK ("estimatedTotalCost" IS NULL OR "estimatedTotalCost" >= 0);

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

CREATE TRIGGER appointments_release_dental_follow_up
  AFTER UPDATE OF "status" ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION appointments_release_dental_follow_up();

-- Source: 20261001193000_clinic_referral_discount

ALTER TABLE "clinics" ADD CONSTRAINT "clinics_pendingReferralDays_check" CHECK ("pendingReferralDays" >= 0);

-- Source: 20261003180000_clinic_doctor_terms

ALTER TABLE "clinic_doctor_terms" ADD CONSTRAINT "clinic_doctor_terms_price_nonneg" CHECK ("appointmentPriceDzd" IS NULL OR "appointmentPriceDzd" >= 0);

ALTER TABLE "clinic_doctor_terms" ADD CONSTRAINT "clinic_doctor_terms_share_range" CHECK ("doctorSharePercent" IS NULL OR ("doctorSharePercent" >= 0 AND "doctorSharePercent" <= 100));

ALTER TABLE "clinic_doctor_invites" ADD CONSTRAINT "clinic_doctor_invites_terms_check" CHECK (
      ("termsPriceDzd" IS NULL OR "termsPriceDzd" >= 0) AND
      ("termsDoctorSharePercent" IS NULL OR ("termsDoctorSharePercent" >= 0 AND "termsDoctorSharePercent" <= 100)));

ALTER TABLE "clinic_transfer_requests" ADD CONSTRAINT "clinic_transfer_requests_terms_check" CHECK (
      ("termsPriceDzd" IS NULL OR "termsPriceDzd" >= 0) AND
      ("termsDoctorSharePercent" IS NULL OR ("termsDoctorSharePercent" >= 0 AND "termsDoctorSharePercent" <= 100)));

ALTER TABLE "appointment_financials" ADD CONSTRAINT "appointment_financials_price_nonneg" CHECK ("priceDzd" IS NULL OR "priceDzd" >= 0);

ALTER TABLE "appointment_financials" ADD CONSTRAINT "appointment_financials_share_range" CHECK ("doctorSharePercent" IS NULL OR ("doctorSharePercent" >= 0 AND "doctorSharePercent" <= 100));

-- Source: 20261011200000_follow_up_shared_minute

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_seq_follow_up_chk"
  CHECK ("slotSeq" >= 0 AND ("slotSeq" = 0 OR ("isFollowUp" = true AND "treatmentPlanId" IS NOT NULL)));

COMMIT;
