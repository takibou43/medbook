import { describe, expect, it } from "vitest";
import { nearestBookingSlot } from "../src/lib/nearestBookingSlot";
const date = new Date("2026-10-07T00:00:00Z");
const now = Date.parse("2026-10-07T13:14:30Z");
const schedules = [{ dayOfWeek: 3, startTime: "14:00", endTime: "17:00", isException: false, exceptionDate: null, isOff: false }];
describe("nearest automatic booking", () => {
  it("starts at the next minute for an empty queue", () => {
    expect(nearestBookingSlot(date, schedules, [], 60, true, now)).toBe("14:15");
  });
  it("keeps the grid with an occupied queue", () => {
    expect(nearestBookingSlot(date, schedules, [], 60, false, now)).toBe("15:00");
  });
  it("protects future reservations", () => {
    expect(nearestBookingSlot(date, schedules, [{ startTime: "15:00", endTime: "16:00" }], 60, true, now)).toBe("16:00");
  });
  it("respects opening and closing times", () => {
    expect(nearestBookingSlot(date, schedules, [], 60, true, Date.parse("2026-10-07T12:00:00Z"))).toBe("14:00");
    expect(nearestBookingSlot(date, schedules, [], 60, true, Date.parse("2026-10-07T15:30:00Z"))).toBeNull();
  });
  it("respects days off", () => {
    expect(nearestBookingSlot(date, [...schedules, { ...schedules[0], isException: true, exceptionDate: date, isOff: true }], [], 60, true, now)).toBeNull();
  });
});
