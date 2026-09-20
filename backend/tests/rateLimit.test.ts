/**
 * حدّ الطلبات يجب أن يُحسب لكل عميل لا للخادم كله: خلف proxy الاستضافة كان كل الزوار يظهرون بعنوان
 * واحد فيتشاركون سلّة واحدة، فاستنفد 100 حجز الحدّ (429) وظهر «تعذّر الاتصال بالخادم» للجميع.
 * لا يحتاج قاعدة بيانات: مسار غير موجود يمرّ عبر apiLimiter ثم يرجع 404.
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

describe("apiLimiter لكل عميل (trust proxy)", () => {
  let app: any;

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = "3";
    process.env.TRUST_PROXY_HOPS = "1";
    const { createApp } = await import("../src/app");
    app = createApp();
  });

  const hit = (ip: string) => request(app).get("/api/__nope__").set("X-Forwarded-For", ip);

  it("عميل مستنفِد حدّه يُرفض بـ429 دون أن يتأثر عميل آخر", async () => {
    for (let i = 0; i < 3; i++) expect((await hit("198.51.100.1")).status).toBe(404);
    expect((await hit("198.51.100.1")).status).toBe(429);
    expect((await hit("198.51.100.2")).status).toBe(404);
  });
});

describe("الحدّ الافتراضي", () => {
  it("لا يقل عن 1500 (يتسع لاستطلاع لوحة الطبيب والحجوزات المتتالية)", async () => {
    delete process.env.RATE_LIMIT_MAX;
    const { vi } = await import("vitest");
    vi.resetModules();
    const { env } = await import("../src/config/env");
    expect(env.rateLimitMax).toBeGreaterThanOrEqual(1500);
  });
});
