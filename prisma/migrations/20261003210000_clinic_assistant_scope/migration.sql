ALTER TABLE "assistants" ADD COLUMN "clinicId" TEXT;
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "assistants" AS a SET "clinicId" = d."clinicId" FROM "doctors" AS d WHERE d."id" = a."doctorId" AND d."clinicId" IS NOT NULL;
