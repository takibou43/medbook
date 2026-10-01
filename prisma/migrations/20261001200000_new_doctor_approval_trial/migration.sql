-- Opt in at registration only, preserving every existing doctor's subscription.
ALTER TABLE "doctors" ADD COLUMN "newDoctorTrial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "doctors" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
