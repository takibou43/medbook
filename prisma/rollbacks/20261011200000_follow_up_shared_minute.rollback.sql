-- Non-destructive rollback to the pre-#50 production guard.
-- Run in one transaction while follow-up writes are stopped.
-- Keep every column and the existing slotSeq unique index. Never discard new bookings.
-- Application rollback must start the previous build with node dist/index.js,
-- without prisma db push (older schemas do not include these additive columns).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "appointments" WHERE "slotSeq" <> 0) THEN
    RAISE EXCEPTION 'Shared-minute follow-ups exist: retain the current schema and use a compatible application rollback';
  END IF;
END $$;
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_slot_seq_follow_up_chk";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_seq_follow_up_chk"
  CHECK ("slotSeq" >= 0 AND ("slotSeq" = 0 OR "doctorFollowUp" = true));
