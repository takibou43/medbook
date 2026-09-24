/**
 * نهاية يوم الموعد بتوقيت الجزائر (UTC+1 ثابت) + حدود منتصف الليل + TTL رسالة Push.
 */
import { describe, it, expect, vi } from "vitest";

// push.ts يستورد عميل Prisma؛ هذه الاختبارات نقية ولا تحتاج قاعدة بيانات.
vi.mock("../src/lib/prisma", () => ({ prisma: {} }));
import { appointmentDayEndsAt, isAppointmentDayOver, appointmentNotificationTag } from "../src/lib/appointmentExpiry";
import { pushTtlSeconds } from "../src/lib/push";

const day = (s: string) => new Date(s + "T00:00:00Z"); // صيغة عمود appointments.date

describe("appointmentDayEndsAt / isAppointmentDayOver", () => {
  it("يوم 2026-09-24 بالجزائر ينتهي عند 00:00 الجزائر يوم 25 = 23:00Z يوم 24", () => {
    expect(appointmentDayEndsAt(day("2026-09-24")).toISOString()).toBe("2026-09-24T23:00:00.000Z");
  });

  it("23:59 بتوقيت الجزائر (22:59Z) ما زال نفس اليوم؛ 00:00 الجزائر (23:00Z) انتهى", () => {
    expect(isAppointmentDayOver(day("2026-09-24"), new Date("2026-09-24T22:59:59.999Z"))).toBe(false);
    expect(isAppointmentDayOver(day("2026-09-24"), new Date("2026-09-24T23:00:00.000Z"))).toBe(true);
  });

  it("00:30 بتوقيت الجزائر يوم 25 (23:30Z يوم 24): موعد يوم 24 منتهٍ، موعد يوم 25 (الغد بتوقيت UTC لا الجزائر) صالح", () => {
    const now = new Date("2026-09-24T23:30:00Z");
    expect(isAppointmentDayOver(day("2026-09-24"), now)).toBe(true);
    expect(isAppointmentDayOver(day("2026-09-25"), now)).toBe(false);
  });

  it("موعد الغد لا ينتهي اليوم", () => {
    expect(isAppointmentDayOver(day("2026-09-25"), new Date("2026-09-24T20:00:00Z"))).toBe(false);
  });

  it("نهاية الشهر/السنة", () => {
    expect(appointmentDayEndsAt(day("2026-12-31")).toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(appointmentDayEndsAt(day("2027-02-28")).toISOString()).toBe("2027-02-28T23:00:00.000Z");
  });

  it("وسم إشعار الموعد موحّد لكل الموعد", () => {
    expect(appointmentNotificationTag("abc")).toBe("appt-abc");
  });
});

describe("pushTtlSeconds", () => {
  const now = new Date("2026-09-24T10:00:00Z");
  it("إشعار عام بلا expiresAt → null (سلوك web-push الافتراضي كما كان)", () => {
    expect(pushTtlSeconds({ title: "t", body: "b" }, now)).toBeNull();
  });
  it("إشعار موعد اليوم → الثواني المتبقية حتى نهاية يوم الموعد", () => {
    expect(pushTtlSeconds({ title: "t", body: "b", expiresAt: "2026-09-24T23:00:00.000Z" }, now)).toBe(13 * 3600);
  });
  it("إشعار موعد منتهٍ → صفر أو أقل (لا يُرسل)", () => {
    expect(pushTtlSeconds({ title: "t", body: "b", expiresAt: "2026-09-24T09:00:00.000Z" }, now)!).toBeLessThanOrEqual(0);
  });
  it("لا يتجاوز حد 4 أسابيع", () => {
    expect(pushTtlSeconds({ title: "t", body: "b", expiresAt: "2027-09-24T00:00:00.000Z" }, now)).toBe(28 * 24 * 3600);
  });
});
