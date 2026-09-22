-- سجل أحداث «متأخر» في الطابور (حدث واحد لكل تأخير في الموعد).
-- إضافة بحتة: جدول جديد فقط. لا تعديل ولا حذف لأي عمود أو بيانات موجودة. عدّاد التأخير نفسه يبقى
-- العمود الموجود أصلًا appointments."deferredCount"، فالمواعيد القديمة تعمل كما هي.

-- CreateTable
CREATE TABLE "appointment_late_events" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "penalty" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_late_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_late_events_appointmentId_sequence_key" ON "appointment_late_events"("appointmentId", "sequence");

-- AddForeignKey
ALTER TABLE "appointment_late_events" ADD CONSTRAINT "appointment_late_events_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
