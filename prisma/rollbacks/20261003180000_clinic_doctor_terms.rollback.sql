-- تراجع عن ترحيل clinic_doctor_terms. يحذف الجدولين الجديدين والأعمدة الجديدة (وقيودها معها).
-- تحذير: يفقد كل الأسعار والنسب واللقطات المالية المسجلة بعد الترحيل. خذ نسخة احتياطية قبل التنفيذ.
-- لا يلمس أي جدول أو عمود كان موجودًا قبل الترحيل. يُنفَّذ بمعاملة واحدة:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f rollback.sql
-- ملاحظة: إن بقيت الشيفرة الجديدة تعمل فـ`prisma db push` سيعيد إنشاء الجداول فارغة (وبلا CHECK) عند أول بدء؛
-- لذلك يُنفَّذ التراجع بعد إعادة نشر الشيفرة السابقة لا قبلها.
DROP TABLE IF EXISTS "appointment_financials";
DROP TABLE IF EXISTS "clinic_doctor_terms";
ALTER TABLE "clinic_doctor_invites" DROP COLUMN IF EXISTS "termsPriceDzd", DROP COLUMN IF EXISTS "termsDoctorSharePercent";
ALTER TABLE "clinic_transfer_requests" DROP COLUMN IF EXISTS "termsPriceDzd", DROP COLUMN IF EXISTS "termsDoctorSharePercent";
