/**
 * lib/push.ts — الإرسال لكل أجهزة المستخدم، وحذف الاشتراك الميت (404/410) تلقائيًا.
 * web-push مستبدلة بمحاكاة، فلا اتصال حقيقي بخدمات الدفع.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  const subs = [
    { id: "s1", userId: "u1", endpoint: "https://push.example/phone", p256dh: "p1", auth: "a1" },
    { id: "s2", userId: "u1", endpoint: "https://push.example/laptop", p256dh: "p2", auth: "a2" },
    { id: "s3", userId: "u1", endpoint: "https://push.example/tablet", p256dh: "p3", auth: "a3" },
  ];
  return {
    subs,
    sendNotification: vi.fn(),
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

import { sendPushToUser, isPushEnabled } from "../src/lib/push";

beforeEach(() => {
  h.sendNotification.mockReset();
  h.db.pushSubscription.delete.mockClear();
});

describe("sendPushToUser", () => {
  it("مريض بعدة أجهزة (هاتف + حاسوب + لوحي): يصل الإشعار إلى كل جهاز", async () => {
    expect(isPushEnabled()).toBe(true);
    h.sendNotification.mockResolvedValue({ statusCode: 201 });
    const r = await sendPushToUser("u1", { title: "t", body: "b" });
    expect(r).toEqual({ sent: 3, removed: 0 });
    expect(h.sendNotification.mock.calls.map((c) => c[0].endpoint)).toEqual([
      "https://push.example/phone",
      "https://push.example/laptop",
      "https://push.example/tablet",
    ]);
  });

  it("اشتراك غير صالح (410 Gone): يُحذف تلقائيًا ولا يُفشل الإرسال لبقية الأجهزة", async () => {
    h.sendNotification.mockImplementation(async (sub: any) => {
      if (sub.endpoint.endsWith("/laptop")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const r = await sendPushToUser("u1", { title: "t", body: "b" });
    expect(r).toEqual({ sent: 2, removed: 1 });
    expect(h.db.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: "s2" } });
  });

  it("خطأ مؤقت (500) لا يحذف الاشتراك ولا يرمي استثناءً", async () => {
    h.sendNotification.mockRejectedValue(Object.assign(new Error("tmp"), { statusCode: 500 }));
    const r = await sendPushToUser("u1", { title: "t", body: "b" });
    expect(r).toEqual({ sent: 0, removed: 0 });
    expect(h.db.pushSubscription.delete).not.toHaveBeenCalled();
  });
});
