import { test } from "node:test";
import assert from "node:assert/strict";
import { canMarkLate, canMarkUnanswered, canOfferNoShow, filterReception, orderReception, receptionLabel, receptionConnection, receptionTime, callAge, callTime } from "../src/lib/assistantReception.ts";
import type { Appointment } from "../src/types/index.ts";
const row = (id: string, changes: Partial<Appointment> = {}): Appointment => ({ id, doctorId: "d1", status: "CONFIRMED", date: "2026-10-04", startTime: "09:00", endTime: "09:15", type: "IN_PERSON", guestFirstName: "سارة", guestLastName: "علي", ...changes });
test("late action covers today's absent waiting patients and timed calls, preserving arrived and terminal patients", () => {
  for (const status of ["CONFIRMED", "LATE", "IN_PROGRESS"] as const) {
    const a = row(status, { status, calledAt: "2026-10-04T08:00:00Z" });
    assert.equal(canMarkLate(a, "2026-10-04"), true);
    assert.equal(canMarkLate({ ...a, arrivedAt: "2026-10-04T08:01:00Z" }, "2026-10-04"), false);
    assert.equal(canMarkLate(a, "2026-10-05"), false);
  }
  for (const status of ["PENDING", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULE_REQUIRED"] as const) {
    assert.equal(canMarkLate(row(status, { status }), "2026-10-04"), false);
  }
  assert.equal(canMarkLate(row("unknown", { status: "IN_PROGRESS" }), "2026-10-04"), false);
});
test("call is not evidence of examination; unknown call time has no nonresponse action", () => {
  const called = row("call", { status: "IN_PROGRESS", calledAt: "2026-10-04T08:00:00Z" });
  assert.equal(receptionLabel(called), "تم نداؤه");
  assert.equal(canMarkUnanswered(called), true);
  assert.equal(canOfferNoShow(called), false);
  assert.equal(canMarkUnanswered(row("unknown", { status: "IN_PROGRESS" })), false);
});
test("arrived patient has one waiting label and no absence action; terminal states remain distinct", () => {
  for (const status of ["CONFIRMED", "LATE"] as const) {
    const a = row(status, { status, arrivedAt: "2026-10-04T07:00:00Z" });
    assert.equal(receptionLabel(a), "وصل — ينتظر"); assert.equal(canOfferNoShow(a), false);
  }
  for (const status of ["COMPLETED", "NO_SHOW", "CANCELLED"] as const) {
    assert.equal(canMarkUnanswered(row(status, { status })), false); assert.equal(canOfferNoShow(row(status, { status })), false);
  }
  assert.notEqual(receptionLabel(row("n", { status: "NO_SHOW" })), receptionLabel(row("c", { status: "CANCELLED" })));
});
test("combined filters preserve separate IDs and family identity for same name/phone", () => {
  const rows = [row("one", { familyMemberId: "child1", arrivedAt: "now" }), row("two", { familyMemberId: "child2", arrivedAt: "now" }), row("other", { doctorId: "d2" })];
  const result = filterReception(rows, { doctorId: "d1", status: "ARRIVED", search: " سارة " }, a => `${a.guestFirstName} ${a.guestLastName}`);
  assert.deepEqual(result.map(a => [a.id, a.familyMemberId]), [["one", "child1"], ["two", "child2"]]);
  assert.deepEqual(filterReception(rows, { doctorId: "d3", status: "", search: "" }, () => ""), []);
});
test("server queue order wins over appointment time without mutating source or dropping rows", () => {
  const rows = [row("early"), row("deferred", { startTime: "08:00" }), row("second", { doctorId: "d2" }), row("called", { status: "IN_PROGRESS" })];
  assert.deepEqual(orderReception(rows, [{ id: "d1", order: ["early", "deferred"] }, { id: "d2", order: ["second"] }]).map(a => a.id), ["called", "early", "deferred", "second"]);
  assert.deepEqual(rows.map(a => a.id), ["early", "deferred", "second", "called"]);
});
test("consistent 24-hour times and real call age, including invalid/future timestamps", () => {
  const timestamp = "2026-10-04T08:03:00Z";
  assert.equal(receptionTime("09:03:00"), "09:03"); assert.equal(callTime(timestamp), "09:03");
  assert.equal(callAge(timestamp, Date.parse(timestamp) + 120000), "نودي منذ 2 دقيقة");
  assert.equal(callAge(timestamp, Date.parse(timestamp) - 1000), "نودي منذ أقل من دقيقة"); assert.equal(callAge("invalid", Date.now()), null);
});
test("unified queue shows all current calls first, retaining each doctor's waiting order", () => {
  const rows = [row("wait-one"), row("wait-two", { doctorId: "d2" }), row("call-two", { doctorId: "d2", status: "IN_PROGRESS" }), row("call-one", { status: "IN_PROGRESS" })];
  assert.deepEqual(orderReception(rows, [{ id: "d1", order: ["wait-one"] }, { id: "d2", order: ["wait-two"] }]).map(a => a.id), ["call-one", "call-two", "wait-one", "wait-two"]);
});
test("connected requires both successful responses, fails on errors and stale data", () => {
  assert.equal(receptionConnection(0, 0, false, 100000), "جارٍ الاتصال…");
  assert.match(receptionConnection(99000, 95000, false, 100000), /^متصل.*5 ثانية/);
  assert.match(receptionConnection(99000, 95000, true, 100000), /^انقطع/);
  assert.match(receptionConnection(1000, 95000, false, 100000), /^التحديث متأخر/);
});
