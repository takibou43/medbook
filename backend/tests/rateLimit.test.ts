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

describe("سلسلة الوسطاء الفعلية (Cloudflare ← Render ← التطبيق)", () => {
  it("الافتراضي 2 قفزات: المفتاح هو عنوان الزائر لا عنوان حافة Cloudflare", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.TRUST_PROXY_HOPS;
    process.env.RATE_LIMIT_MAX = "3";
    const { env } = await import("../src/config/env");
    expect(env.trustProxyHops).toBe(2);
    const { createApp } = await import("../src/app");
    const app = createApp();
    // socket = موجّه Render (loopback هنا)، X-Forwarded-For = "<الزائر>, <حافة Cloudflare>"
    const hit = (client: string, edge: string) => request(app).get("/api/__nope__").set("X-Forwarded-For", `${client}, ${edge}`);
    // زائر واحد يصل عبر حواف مختلفة: يجب أن يُعدّ في سلّة واحدة
    expect((await hit("198.51.100.10", "104.23.1.1")).status).toBe(404);
    expect((await hit("198.51.100.10", "104.23.2.2")).status).toBe(404);
    expect((await hit("198.51.100.10", "104.23.3.3")).status).toBe(404);
    expect((await hit("198.51.100.10", "104.23.4.4")).status).toBe(429);
    // زائر آخر عبر نفس الحافة لا يتأثر
    expect((await hit("198.51.100.11", "104.23.1.1")).status).toBe(404);
  });

  it("رأس X-Forwarded-For المزوَّر من العميل لا يغيّر المفتاح", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.TRUST_PROXY_HOPS;
    process.env.RATE_LIMIT_MAX = "2";
    const { createApp } = await import("../src/app");
    const app = createApp();
    // المزوِّر يضع عناوين عشوائية في بداية السلسلة؛ Cloudflare يضيف الزائر الحقيقي بعدها
    const hit = (fake: string) => request(app).get("/api/__nope__").set("X-Forwarded-For", `${fake}, 198.51.100.20, 104.23.1.1`);
    expect((await hit("1.1.1.1")).status).toBe(404);
    expect((await hit("2.2.2.2")).status).toBe(404);
    expect((await hit("3.3.3.3")).status).toBe(429);
  });
});
