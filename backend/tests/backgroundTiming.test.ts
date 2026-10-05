import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/prisma", () => ({ prisma: {} }));
import { reminderDelay } from "../src/lib/backgroundTiming";
const now = new Date("2026-10-05T06:00:00Z");
describe("reminder scheduling preserves due and queue notifications", () => {
  it("backs off only when there are no imminent appointments or reminders", () => {
    expect(reminderDelay([], null, now, 60000)).toBe(900000);
    expect(reminderDelay([new Date("2026-10-05T12:00:00Z")], null, now, 60000)).toBe(900000);
  });
  it("keeps the minute cadence for imminent and already waiting patients", () => {
    expect(reminderDelay([new Date("2026-10-05T07:00:00Z")], null, now, 60000)).toBe(60000);
    expect(reminderDelay([new Date("2026-10-05T05:00:00Z")], null, now, 60000)).toBe(60000);
  });
  it("wakes for a due reminder even if its appointment no longer appears in the upcoming list", () => {
    expect(reminderDelay([], new Date("2026-10-05T06:05:00Z"), now, 60000)).toBe(300000);
    expect(reminderDelay([], new Date("2026-10-05T05:59:00Z"), now, 60000)).toBe(60000);
  });
});
