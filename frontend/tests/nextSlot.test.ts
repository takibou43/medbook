import { test } from "node:test";
import assert from "node:assert/strict";
import { isUpcomingSlot, nextSlotErrorKind } from "../src/lib/nextSlot.ts";

test("availability uses Algeria time and rejects expired or malformed cached slots", () => {
  const slot = { date: "2026-10-25", startTime: "00:15", endTime: "00:30", slotMinutes: 15 };
  assert.equal(isUpcomingSlot(slot, Date.parse("2026-10-24T23:14:59Z")), true);
  assert.equal(isUpcomingSlot(slot, Date.parse("2026-10-24T23:15:01Z")), false);
  assert.equal(isUpcomingSlot({ ...slot, date: "invalid" }), false);
  assert.equal(isUpcomingSlot(undefined), false);
});

test("network, rate limits and server errors never claim that a doctor's schedule is full", () => {
  for (const status of [undefined, 429, 500, 503]) {
    assert.equal(nextSlotErrorKind({ response: { status } }), "failed");
  }
  assert.equal(nextSlotErrorKind(new Error("offline")), "failed");
  assert.equal(nextSlotErrorKind({ response: { status: 409 } }), "noSlots");
  assert.equal(nextSlotErrorKind({ response: { status: 404 } }), "unavailable");
});
