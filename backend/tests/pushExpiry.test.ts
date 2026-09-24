/**
 * lib/push.ts مع إشعارات المواعيد: TTL حتى نهاية يوم الموعد، ولا إرسال لإشعار موعد انتهى.
 * web-push مستبدلة بمحاكاة، فلا اتصال حقيقي بخدمات الدفع.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  const subs = [{ id: "s1", userId: "u1", endpoint: "https://push.example/phone", p256dh: "p1", auth: "a1" }];
  return {
    sendNotification: vi.fn(async () => ({ statusCode: 201 })),
    db: {
      pushSubscription: {
        findMany: vi.fn(async ({ where }: any) => subs.filter((s) => s.userId === where.userId)),
        delete: vi.fn(async () => ({})),
      },
    },
  };
});

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: h.sendNotification } }));
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));

import { sendPushToUser } from "../src/lib/push";

beforeEach(() => {
  h.sendNotification.mockClear();
  h.db.pushSubscription.findMany.mockClear();
});

describe("sendPushToUser — إشعارات المواعيد", () => {
  it("إشعار موعد صالح: يُرسل مع TTL = الثواني المتبقية حتى نهاية يوم الموعد، والحمولة تحمل الموعد", async () => {
    const expiresAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const r = await sendPushToUser("u1", { title: "t", body: "b", tag: "appt-A1", appointmentId: "A1", appointmentDate: "2026-09-24", expiresAt });
    expect(r.sent).toBe(1);
    const [, payloadRaw, options] = h.sendNotification.mock.calls[0] as any[];
    const payload = JSON.parse(payloadRaw);
    expect(payload).toMatchObject({ tag: "appt-A1", appointmentId: "A1", appointmentDate: "2026-09-24", expiresAt });
    expect(options.TTL).toBeGreaterThan(3 * 3600 - 5);
    expect(options.TTL).toBeLessThanOrEqual(3 * 3600);
  });

  it("إشعار موعد انتهى يومه: لا إرسال إطلاقًا ولا حتى قراءة الاشتراكات", async () => {
    const r = await sendPushToUser("u1", { title: "t", body: "b", appointmentId: "A1", expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(r).toEqual({ sent: 0, removed: 0 });
    expect(h.sendNotification).not.toHaveBeenCalled();
    expect(h.db.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it("إشعار عام (بلا موعد): كما كان تمامًا — وسيطان فقط بلا TTL خاص", async () => {
    await sendPushToUser("u1", { title: "t", body: "b", tag: "NEW_MESSAGE" });
    expect(h.sendNotification.mock.calls[0]).toHaveLength(2);
  });
});
