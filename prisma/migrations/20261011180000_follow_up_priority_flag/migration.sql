-- Additive and idempotent. Adds a standalone boolean marking doctor-scheduled medical follow-up appointments
-- (queue priority only; booking time/slot constraints are untouched). Existing rows default to false.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "isFollowUp" BOOLEAN NOT NULL DEFAULT false;
-- Protection anchor stored when a follow-up patient arrives (see backend/src/lib/queuePriority.ts). NULL = not stored.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "followUpAnchorId" TEXT;

-- Backfill only rows that are verifiably doctor-scheduled follow-ups: linked to a parent appointment,
-- created by the doctor, and of type FOLLOW_UP (the exact shape written by createFollowUpAppointment).
-- Safe to re-run: touches only rows still false, never changes time, status, or any other column.
UPDATE "appointments"
SET "isFollowUp" = true
WHERE "isFollowUp" = false
  AND "parentAppointmentId" IS NOT NULL
  AND "createdBy" = 'DOCTOR'
  AND "type" = 'FOLLOW_UP';
