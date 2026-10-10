CREATE TABLE "guest_identity_claims" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3),
  "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "guest_identity_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guest_identity_claims_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "guest_identity_claims_patientId_key" ON "guest_identity_claims"("patientId");
CREATE INDEX "guest_identity_claims_phone_lastSentAt_idx" ON "guest_identity_claims"("phone", "lastSentAt");
