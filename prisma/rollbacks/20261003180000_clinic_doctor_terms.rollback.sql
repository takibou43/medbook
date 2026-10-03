-- تراجع عن ترحيل clinic_doctor_terms (يحذف الجدولين الجديدين والأعمدة الجديدة وقيودها).
--
-- تحذير: هذا التراجع يفقد نهائيًا كل الأسعار والنسب واللقطات المالية المسجلة بعد تفعيل الميزة.
-- لذلك يرفض التنفيذ (دون أي تغيير) إذا وُجدت أي بيانات مالية، إلا إن مُرِّر التأكيد الصريح confirm_data_loss=yes.
-- الأسلم عادةً: إعادة نشر الشيفرة السابقة فقط وترك الجداول (لا يقرأها الإصدار القديم ولا تضرّ).
--
-- الخطوات:
--  1) خذ نسخة احتياط للبيانات المالية أولًا:
--       pg_dump "$DATABASE_URL" -t clinic_doctor_terms -t appointment_financials --data-only > terms-backup.sql
--     (والأعمدة termsPriceDzd/termsDoctorSharePercent في clinic_doctor_invites وclinic_transfer_requests تُحفظ بنسخة كاملة للجدولين.)
--  2) أعد نشر الشيفرة السابقة (وإلا أعاد prisma db push إنشاء الجداول فارغة).
--  3) نفّذ بلا تأكيد لترى العدد:   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <هذا الملف>
--     وإن كان العدد صفرًا فيمضي التراجع، وإلا يتوقف برسالة واضحة.
--  4) للمتابعة رغم وجود بيانات، بعد النسخة الاحتياط وموافقة صريحة:
--       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_data_loss=yes --single-transaction -f <هذا الملف>
-- لا يلمس أي جدول أو عمود كان موجودًا قبل الترحيل.

SELECT
  (SELECT count(*) FROM "clinic_doctor_terms") AS terms_rows,
  (SELECT count(*) FROM "appointment_financials") AS financial_rows,
  (SELECT count(*) FROM "clinic_doctor_invites" WHERE "termsPriceDzd" IS NOT NULL OR "termsDoctorSharePercent" IS NOT NULL) AS invites_with_terms,
  (SELECT count(*) FROM "clinic_transfer_requests" WHERE "termsPriceDzd" IS NOT NULL OR "termsDoctorSharePercent" IS NOT NULL) AS transfers_with_terms
\gset
\echo 'بيانات مالية ستُحذف: شروط=':terms_rows ' لقطات مواعيد=':financial_rows ' دعوات بشروط=':invites_with_terms ' طلبات انتقال بشروط=':transfers_with_terms
\if :{?confirm_data_loss}
\else
  \set confirm_data_loss no
\endif
SELECT ((:terms_rows + :financial_rows + :invites_with_terms + :transfers_with_terms) > 0 AND :'confirm_data_loss' <> 'yes') AS blocked \gset
\if :blocked
  \echo 'توقف: توجد بيانات مالية. لم يتغير شيء. خذ نسخة احتياط ثم أعد التنفيذ مع -v confirm_data_loss=yes'
  DO $$ BEGIN RAISE EXCEPTION 'rollback blocked: financial data exists; pass -v confirm_data_loss=yes after taking a backup'; END $$;
\endif

DROP TABLE IF EXISTS "appointment_financials";
DROP TABLE IF EXISTS "clinic_doctor_terms";
ALTER TABLE "clinic_doctor_invites" DROP COLUMN IF EXISTS "termsPriceDzd", DROP COLUMN IF EXISTS "termsDoctorSharePercent";
ALTER TABLE "clinic_transfer_requests" DROP COLUMN IF EXISTS "termsPriceDzd", DROP COLUMN IF EXISTS "termsDoctorSharePercent";
