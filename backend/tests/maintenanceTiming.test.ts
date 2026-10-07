import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  doctor: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  notification: { findFirst: vi.fn() },
  appointment: { findMany: vi.fn() },
}));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));
import { nextMaintenanceDelay } from "../src/lib/maintenanceTiming";
import { quietCheckDelay } from "../src/lib/backgroundTiming";
import { sweepStaleAppointmentsForAllDoctors } from "../src/modules/appointments/appointments.service";
const now = new Date("2026-10-07T14:00:00Z"); // 15:00 in Algeria
const day = new Date("2026-10-07T00:00:00Z");
function candidate(endTime: string, date = day) {
  return { id: "doctor", appointments: [{ date }], schedules: [{
    dayOfWeek: date.getUTCDay(), startTime: "08:00", endTime,
    isException: false, exceptionDate: null, isOff: false,
  }] };
}
beforeEach(() => {
  vi.resetAllMocks();
  db.doctor.findFirst.mockResolvedValue(null);
  db.doctor.findMany.mockResolvedValue([]);
  db.notification.findFirst.mockResolvedValue(null);
});
describe("quiet maintenance keeps real deadlines", () => {
  it("waits one hour without work and aligns unrelated jobs to the same window", async () => {
    expect(await nextMaintenanceDelay(now)).toBe(3_600_000);
    expect(quietCheckDelay(new Date("2026-10-07T14:17:00Z"))).toBe(43 * 60_000);
  });
  it("wakes just after clinic closing in Algeria instead of waiting an hour", async () => {
    db.doctor.findMany.mockResolvedValue([candidate("15:05")]);
    expect(await nextMaintenanceDelay(now)).toBe(300_001);
  });
  it("uses the end-of-day fallback when no schedule exists", async () => {
    db.doctor.findMany.mockResolvedValue([{ ...candidate("15:05"), schedules: [] }]);
    expect(await nextMaintenanceDelay(new Date("2026-10-07T22:50:00Z"))).toBe(540_001);
  });
  it("wakes for the earlier subscription or notification expiry", async () => {
    db.doctor.findFirst.mockResolvedValue({ subscriptionExpiresAt: new Date(now.getTime() + 180_000) });
    db.notification.findFirst.mockResolvedValue({ expiresAt: new Date(now.getTime() + 120_000) });
    expect(await nextMaintenanceDelay(now)).toBe(120_000);
    db.notification.findFirst.mockResolvedValue(null);
    expect(await nextMaintenanceDelay(now)).toBe(180_001);
  });
  it("retries overdue work in a minute without spinning or sleeping for an hour", async () => {
    db.doctor.findMany.mockResolvedValue([candidate("14:00")]);
    expect(await nextMaintenanceDelay(now)).toBe(60_000);
  });
  it("propagates scheduling failures to the adaptive job retry", async () => {
    db.notification.findFirst.mockRejectedValue(new Error("offline"));
    await expect(nextMaintenanceDelay(now)).rejects.toThrow("offline");
  });
  it("skips per-doctor expiry reads while a clinic is still open", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    try {
      db.doctor.findMany.mockResolvedValue([candidate("16:00")]);
      await sweepStaleAppointmentsForAllDoctors();
      expect(db.doctor.findUnique).not.toHaveBeenCalled();
      expect(db.appointment.findMany).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("still processes an unresolved appointment from a previous day", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    try {
      const doctor = candidate("16:00", new Date("2026-10-06T00:00:00Z"));
      db.doctor.findMany.mockResolvedValue([doctor]);
      db.doctor.findUnique.mockResolvedValue({ schedules: doctor.schedules });
      db.appointment.findMany.mockResolvedValue([]);
      await sweepStaleAppointmentsForAllDoctors();
      expect(db.doctor.findUnique).toHaveBeenCalledWith({ where: { id: "doctor" }, select: { schedules: true } });
      expect(db.appointment.findMany).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
