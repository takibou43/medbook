-- AlterTable: إضافة إحداثيات اختيارية (nullable) لموقع الطبيب/العيادة فقط — بلا حذف
-- ولا تعديل على أي عمود موجود. لا قيمة افتراضية: الأطباء الحاليون يبقون بلا إحداثيات
-- حتى يضبطوها بأنفسهم من إعدادات الحساب.
ALTER TABLE "doctors" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "doctors" ADD COLUMN "longitude" DOUBLE PRECISION;
