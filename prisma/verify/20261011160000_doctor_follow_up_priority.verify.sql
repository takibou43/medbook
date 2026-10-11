-- فحوصات بعد تطبيق الترحيل (للقراءة فقط).
SELECT count(*) AS rows_with_seq FROM "appointments" WHERE "slotSeq" <> 0;                 -- متوقع 0 قبل أول متابعة
SELECT count(*) AS rows_marked_follow_up FROM "appointments" WHERE "doctorFollowUp";       -- متوقع 0 قبل أول متابعة
SELECT indexdef FROM pg_indexes WHERE indexname = 'appointments_doctorId_date_startTime_activeSlot_key'; -- يجب أن يذكر slotSeq
SELECT conname FROM pg_constraint WHERE conname = 'appointments_slot_seq_follow_up_chk';
