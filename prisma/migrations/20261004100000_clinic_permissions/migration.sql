-- Additive defaults preserve existing shared assistants and all subscriptions/accounts.
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "clinicManagerForId" TEXT;
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "clinicPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "assistants" ADD COLUMN IF NOT EXISTS "allDoctors" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "assistants" ADD COLUMN IF NOT EXISTS "allowedDoctorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "assistant_invites" ADD COLUMN IF NOT EXISTS "clinicId" TEXT;
ALTER TABLE "assistant_invites" ADD COLUMN IF NOT EXISTS "allDoctors" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "assistant_invites" ADD COLUMN IF NOT EXISTS "allowedDoctorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
