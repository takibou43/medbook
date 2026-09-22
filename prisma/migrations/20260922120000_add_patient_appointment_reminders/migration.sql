-- تذكيرات Push لمواعيد المرضى أصحاب الحسابات (قبل ساعة + قبل 5 دقائق).
-- إضافة بحتة: نوعان جديدان وجدول جديد فقط. لا تعديل ولا حذف لأي عمود أو بيانات موجودة،
-- والمواعيد القديمة (ومنها حجوزات الضيوف patientId = NULL) لا تتأثر إطلاقًا.

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('ONE_HOUR', 'FIVE_MINUTES');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "appointment_reminders" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_reminders_appointmentId_type_key" ON "appointment_reminders"("appointmentId", "type");

-- CreateIndex
CREATE INDEX "appointment_reminders_status_scheduledFor_idx" ON "appointment_reminders"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
