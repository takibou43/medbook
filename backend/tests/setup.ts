/**
 * يُنفَّذ قبل كل ملف اختبار (انظر vitest.config.ts).
 *
 * الهدف: جعل `npm test` يعمل في بيئة نظيفة بلا ملف .env وبلا قاعدة بيانات.
 * القيم أدناه وهمية ومخصّصة للاختبارات فقط، ولا تُستخدم في أي بيئة حقيقية.
 * إن كانت المتغيرات مضبوطة مسبقًا (مثلاً TEST_DATABASE_URL في اختبار التكامل) فلا تُلمس.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "postgresql://medbook:medbook@localhost:5432/medbook_test?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_only_access_secret_do_not_use_in_production";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test_only_refresh_secret_do_not_use_in_production";

// حماية إغراق جدول المواعيد (حدود معدل الحجز + سقوف المواعيد لكل مريض) تُعطَّل هنا للاختبارات القديمة فقط،
// لأنها تحجز عشرات المواعيد بحساب واحد وطبيب واحد. لا مفتاح في كود الإنتاج: التعطيل محاكاة داخل الاختبارات،
// والمنطق الحقيقي مُختبَر مباشرة في tests/bookingQuota.test.ts (عبر vi.importActual).
import { vi } from "vitest";

vi.mock("../src/lib/bookingQuota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/bookingQuota")>()),
  assertBookingQuota: async () => undefined,
}));

vi.mock("../src/middleware/rateLimiter", async (importOriginal) => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    ...(await importOriginal<typeof import("../src/middleware/rateLimiter")>()),
    bookingCreateBurstLimiter: pass,
    bookingCreateDailyLimiter: pass,
  };
});
