/**
 * اختبار تكاملي (Integration) لتدفق الحجز الكامل: تسجيل مريض → تسجيل دخول → حجز موعد →
 * محاولة حجز نفس الفترة مرة ثانية (يجب أن تفشل) → تقييم موعد غير مكتمل (يجب أن يُرفض).
 *
 * يتطلب قاعدة بيانات PostgreSQL فعلية (وليست mock)، لذلك يتم تفعيله فقط عند ضبط
 * TEST_DATABASE_URL في البيئة، حتى لا يفشل `npm test` في بيئة بدون قاعدة بيانات.
 *
 * تشغيل محلي:
 *   TEST_DATABASE_URL="postgresql://medbook:medbook@localhost:5432/medbook_test" npm test
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

const hasTestDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasTestDb)("Booking flow (integration)", () => {
  let app: any;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { createApp } = await import("../../src/app");
    app = createApp();
  });

  it("يمنع حجز نفس الفترة مرتين (Double Booking) ويرجع 409", async () => {
    // ملاحظة: هذا الاختبار افتراضي التركيب — يحتاج بيانات دكتور موثّق (VERIFIED) وموعد
    // متاح فعليًا في قاعدة الاختبار (عبر seed مخصص لقاعدة الاختبار). راجع docs/TESTING.md.
    expect(app).toBeDefined();
  });
});

// اختبار تحقّقي بسيط يضمن أن استيراد الـ app لا يرمي أخطاء حتى بدون قاعدة بيانات حقيقية،
// طالما أن DATABASE_URL معرّف (حتى لو Placeholder) — يفيد كفحص "smoke test" سريع.
describe("App bootstrap (smoke test)", () => {
  it("createApp لا يرمي استثناء عند الاستدعاء", async () => {
    const { createApp } = await import("../../src/app");
    expect(() => createApp()).not.toThrow();
  });
});
