import { test } from "node:test";
import assert from "node:assert/strict";
import { upcomingAppointment } from "../src/lib/upcomingAppointment.ts";
import type { MyAppointment } from "../src/types/index.ts";

const make = (id: string, date: string, status: MyAppointment["status"], startTime = "09:00"): MyAppointment => ({
  id, date, status, startTime, endTime: "09:20", type: "IN_PERSON",
  doctor: { id: "doctor", firstName: "طبيب", lastName: "اختبار" },
});
const now = Date.parse("2026-10-24T23:30:00Z"); // Already October 25 in Algeria.

test("home card excludes finished/cancelled/missed appointments and previous Algerian dates", () => {
  const list = [make("yesterday", "2026-10-24", "CONFIRMED"),
    ...(["CANCELLED", "COMPLETED", "NO_SHOW"] as const).map(s => make(s, "2026-10-25", s)),
    make("tomorrow", "2026-10-26", "CONFIRMED"), make("today", "2026-10-25T00:00:00.000Z", "CONFIRMED")];
  const original = list.map(a => a.id);
  assert.equal(upcomingAppointment(list, now)?.id, "today");
  assert.deepEqual(list.map(a => a.id), original);
  assert.equal(upcomingAppointment([], now), undefined);
});

test("today's waiting/late visits remain accessible after their scheduled time; family identity is retained", () => {
  const late = { ...make("late", "2026-10-25", "LATE", "08:00"),
    beneficiary: { type: "FAMILY_MEMBER" as const, name: "طفل الاختبار", relationship: "CHILD" as const, familyMemberId: "child" } };
  assert.equal(upcomingAppointment([make("later", "2026-10-25", "CONFIRMED", "15:00"), late], Date.parse("2026-10-25T10:00:00Z")), late);
});

test("appointments needing rescheduling remain visible so the card can explain the action", () => {
  assert.equal(upcomingAppointment([make("change", "2026-10-25", "RESCHEDULE_REQUIRED")], now)?.status, "RESCHEDULE_REQUIRED");
});
