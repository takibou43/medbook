ALTER TABLE "doctors" ADD COLUMN "dutyEndsAt" TIMESTAMP(3), ADD COLUMN "queueRequestedAt" TIMESTAMP(3);
ALTER TABLE "assistants" ADD COLUMN "shiftEndsAt" TIMESTAMP(3);
