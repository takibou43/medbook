import { describe, expect, it } from "vitest";
import { firstPresent } from "../src/lib/presentQueue";
const row = (id: string, startTime: string, present = true, status = "CONFIRMED") => ({ id, startTime, arrivedAt: present ? new Date() : null, status });
describe("present appointment priority", () => {
  it("uses appointment time regardless of booking order", () => {
    expect(firstPresent([row("mohamed", "10:00"), row("ahmed", "09:00")])?.id).toBe("ahmed");
  });
  it("allows the last patient early when earlier patients are absent", () => {
    expect(firstPresent([row("ahmed", "09:00", false), row("mohamed", "10:00")])?.id).toBe("mohamed");
  });
  it("restores original priority to a late patient who arrives", () => {
    expect(firstPresent([row("mohamed", "10:00"), row("ahmed", "09:00", true, "LATE")])?.id).toBe("ahmed");
  });
  it("never admits an absent, completed, or already admitted patient", () => {
    expect(firstPresent([row("a", "09:00", false), row("b", "10:00", true, "IN_PROGRESS"), row("c", "11:00", true, "COMPLETED")])).toBeNull();
  });
});
