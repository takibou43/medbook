-- تحقق للقراءة فقط بعد تطبيق ترحيل clinic_doctor_terms (لا يغيّر شيئًا).
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 20261003180000_clinic_doctor_terms.verify.sql
-- كل صف نتيجته ok = true يعني نجاح الفحص. أي false يعني أن الترحيل ناقص.
WITH expected_constraints(name) AS (VALUES
  ('clinic_doctor_terms_price_nonneg'), ('clinic_doctor_terms_share_range'),
  ('clinic_doctor_invites_terms_check'), ('clinic_transfer_requests_terms_check'),
  ('appointment_financials_price_nonneg'), ('appointment_financials_share_range'),
  ('clinic_doctor_terms_clinicId_fkey'), ('clinic_doctor_terms_doctorId_fkey'), ('appointment_financials_appointmentId_fkey')),
expected_columns(tbl, col) AS (VALUES
  ('clinic_doctor_invites','termsPriceDzd'), ('clinic_doctor_invites','termsDoctorSharePercent'),
  ('clinic_transfer_requests','termsPriceDzd'), ('clinic_transfer_requests','termsDoctorSharePercent'),
  ('clinic_doctor_terms','appointmentPriceDzd'), ('clinic_doctor_terms','doctorSharePercent'),
  ('appointment_financials','priceDzd'), ('appointment_financials','doctorSharePercent'), ('appointment_financials','clinicId'))
SELECT 'constraint ' || e.name AS check_name, EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = e.name) AS ok FROM expected_constraints e
UNION ALL
SELECT 'column ' || e.tbl || '.' || e.col, EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name = e.tbl AND c.column_name = e.col) FROM expected_columns e
UNION ALL
SELECT 'unique index clinic_doctor_terms_doctorId_key', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'clinic_doctor_terms_doctorId_key')
UNION ALL
-- لا بيانات مالية مفترضة للأطباء الحاليين: بعد الترحيل مباشرة الجدولان فارغان (يصير false طبيعيًا بعد بدء الاستعمال)
SELECT 'info: clinic_doctor_terms rows = ' || (SELECT count(*) FROM clinic_doctor_terms), true
UNION ALL
SELECT 'info: appointment_financials rows = ' || (SELECT count(*) FROM appointment_financials), true
UNION ALL
-- قيم خارج النطاق يجب ألا توجد أبدًا
SELECT 'no out-of-range shares', NOT EXISTS (SELECT 1 FROM clinic_doctor_terms WHERE "doctorSharePercent" NOT BETWEEN 0 AND 100)
  AND NOT EXISTS (SELECT 1 FROM appointment_financials WHERE "doctorSharePercent" NOT BETWEEN 0 AND 100)
UNION ALL
SELECT 'every financial row has an existing appointment', NOT EXISTS (SELECT 1 FROM appointment_financials f LEFT JOIN appointments a ON a.id = f."appointmentId" WHERE a.id IS NULL)
ORDER BY 1;

-- معلومة للتقرير (للقراءة فقط): مواعيد مكتملة لأطباء داخل عيادات بلا لقطة مالية. بعد الترحيل مباشرة = كل المكتملة السابقة،
-- وهي لن تُحسب لها مستحقات (تظهر في عدّاد «بلا نسبة»).
SELECT count(*) AS completed_clinic_appointments_without_snapshot
FROM appointments a
JOIN doctors d ON d.id = a."doctorId" AND d."clinicId" IS NOT NULL
LEFT JOIN appointment_financials f ON f."appointmentId" = a.id
WHERE a.status = 'COMPLETED' AND f."appointmentId" IS NULL;
