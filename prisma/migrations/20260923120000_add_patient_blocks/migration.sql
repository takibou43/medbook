-- حظر المرضى من إنشاء حجوزات جديدة.
-- إضافة بحتة: جدول جديد فقط، بلا أي تعديل أو حذف لأعمدة أو بيانات موجودة (المرضى والمواعيد كما هي).

-- CreateTable
CREATE TABLE "patient_blocks" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "activePatientId" TEXT,
    "reason" TEXT,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedBy" TEXT,
    "unblockedAt" TIMESTAMP(3),
    "unblockedBy" TEXT,

    CONSTRAINT "patient_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_blocks_activePatientId_key" ON "patient_blocks"("activePatientId");

-- CreateIndex
CREATE INDEX "patient_blocks_patientId_idx" ON "patient_blocks"("patientId");

-- AddForeignKey
ALTER TABLE "patient_blocks" ADD CONSTRAINT "patient_blocks_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
