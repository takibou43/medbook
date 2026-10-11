-- فحوصات للقراءة فقط بعد تطبيق الترحيل 20261011200000.
SELECT count(*) AS total_appointments FROM "appointments";
SELECT count(*) AS rows_with_seq FROM "appointments" WHERE "slotSeq" <> 0;                -- متوقع 0 قبل أول متابعة مشتركة
SELECT count(*) AS is_follow_up_rows FROM "appointments" WHERE "isFollowUp";              -- = مواعيد العودة المثبتة (2 وقت الفحص)
SELECT count(*) AS violating_check FROM "appointments" WHERE NOT ("slotSeq" >= 0 AND ("slotSeq" = 0 OR ("isFollowUp" AND "treatmentPlanId" IS NOT NULL))); -- متوقع 0
SELECT indexdef FROM pg_indexes WHERE indexname = 'appointments_doctorId_date_startTime_activeSlot_key';  -- يذكر slotSeq
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'appointments_slot_seq_follow_up_chk';
SELECT count(*) AS dup_active_groups FROM (SELECT 1 FROM "appointments" WHERE status <> 'CANCELLED' AND "slotSeq" = 0 GROUP BY "doctorId","date","startTime" HAVING count(*) > 1) d;  -- متوقع 0
