-- يربط إشعار «طبيب جديد في منطقتك» بالطبيب الذي أُعلن عنه.
-- القيد الفريد يجعل الإنشاء idempotent: إعادة توثيق الطبيب لا تكرر الإشعار للمريض نفسه.
ALTER TABLE "notifications" ADD COLUMN "newDoctorId" TEXT;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_newDoctorId_fkey"
  FOREIGN KEY ("newDoctorId") REFERENCES "doctors"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notifications_newDoctorId_idx" ON "notifications"("newDoctorId");

CREATE UNIQUE INDEX "notifications_userId_type_newDoctorId_key"
  ON "notifications"("userId", "type", "newDoctorId");

-- كان patients.cityId موجودًا دون مفتاح أجنبي؛ نثبّت العلاقة حتى لا تُحفظ منطقة غير صالحة.
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "cities"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "patients_cityId_idx" ON "patients"("cityId");
