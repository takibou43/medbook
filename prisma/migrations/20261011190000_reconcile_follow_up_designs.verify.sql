-- فحص قراءة فقط قبل/بعد التوحيد (أعداد فقط، بلا بيانات شخصية).
SELECT
  count(*)                                                        AS total,
  count(*) FILTER (WHERE "doctorFollowUp")                        AS legacy_follow_up_true,
  count(*) FILTER (WHERE "slotSeq" > 0)                           AS legacy_slot_seq_gt0,
  count(*) FILTER (WHERE "parentAppointmentId" IS NOT NULL AND "createdBy" = 'DOCTOR' AND "type" = 'FOLLOW_UP') AS legacy_follow_ups_by_shape
FROM "appointments";
SELECT indexdef FROM pg_indexes WHERE tablename = 'appointments' AND indexname = 'appointments_doctorId_date_startTime_activeSlot_key';
