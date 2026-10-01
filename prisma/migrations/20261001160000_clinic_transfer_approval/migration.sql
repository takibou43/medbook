CREATE TABLE "clinic_transfer_requests" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "pendingDoctorId" TEXT,
  "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  CONSTRAINT "clinic_transfer_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "clinic_transfer_requests_pendingDoctorId_key" ON "clinic_transfer_requests"("pendingDoctorId");
CREATE INDEX "clinic_transfer_requests_clinicId_status_idx" ON "clinic_transfer_requests"("clinicId", "status");
ALTER TABLE "clinic_transfer_requests" ADD CONSTRAINT "clinic_transfer_requests_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_transfer_requests" ADD CONSTRAINT "clinic_transfer_requests_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
