-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CLINIC_OWNER';

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "paidDoctorCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "subscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "clinic_doctor_invites" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "clinic_doctor_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_doctor_invites_tokenHash_key" ON "clinic_doctor_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "clinic_doctor_invites_clinicId_status_idx" ON "clinic_doctor_invites"("clinicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clinics_ownerId_key" ON "clinics"("ownerId");

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_doctor_invites" ADD CONSTRAINT "clinic_doctor_invites_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
