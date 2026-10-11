-- Additive only: creates a new per-doctor settings table; no existing table or row is touched.
CREATE TABLE "prescription_settings" (
    "doctorId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "professional" JSONB,
    "show" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prescription_settings_pkey" PRIMARY KEY ("doctorId"),
    CONSTRAINT "prescription_settings_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
