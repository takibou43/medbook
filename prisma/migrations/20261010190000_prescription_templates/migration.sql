CREATE TABLE "prescription_templates" (
    "doctorId" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "top" INTEGER NOT NULL DEFAULT 40,
    "bottom" INTEGER NOT NULL DEFAULT 30,
    "side" INTEGER NOT NULL DEFAULT 12,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prescription_templates_pkey" PRIMARY KEY ("doctorId"),
    CONSTRAINT "prescription_templates_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
