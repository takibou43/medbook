/** POST /api/internal/reminders/run — محمي بالسر X-Cron-Secret، ولا يُشغّل الدورة إلا بسر صحيح. */
import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";

const h = vi.hoisted(() => {
  process.env.REMINDER_CRON_SECRET = "test-only-cron-secret-value";
  return { run: vi.fn(async () => ({ created: 2, sent: 1, skipped: 0, failed: 0 })) };
});
vi.mock("../src/lib/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/reminders/reminders.service", () => ({ runReminderCycle: h.run }));

let app: any;
beforeAll(async () => {
  const { createApp } = await import("../src/app");
  app = createApp();
});

describe("المسار الداخلي لتشغيل التذكيرات", () => {
  it("بلا سر أو بسر خاطئ => 401 ولا تُشغَّل الدورة", async () => {
    expect((await request(app).post("/api/internal/reminders/run")).status).toBe(401);
    expect((await request(app).post("/api/internal/reminders/run").set("X-Cron-Secret", "wrong")).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("بالسر الصحيح => 200 مع إحصائيات الدورة، والسر لا يظهر في الرد", async () => {
    const r = await request(app).post("/api/internal/reminders/run").set("X-Cron-Secret", "test-only-cron-secret-value");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ created: 2, sent: 1, skipped: 0, failed: 0 });
    expect(JSON.stringify(r.body)).not.toContain("test-only-cron-secret-value");
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("GET غير مسموح (المسار POST فقط)", async () => {
    expect((await request(app).get("/api/internal/reminders/run").set("X-Cron-Secret", "test-only-cron-secret-value")).status).toBe(404);
  });
});
