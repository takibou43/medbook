import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Appointment } from "../src/types/index.ts";
import { admissionCandidate, callSignatures, newlyCalled } from "../src/lib/assistantCalls.ts";
const current = (id: string, calledAt = "first") => ({ id, calledAt }) as Appointment;
describe("simultaneous doctor calls", () => {
  it("detects both doctors without a selection and does not repeat unchanged calls", () => {
    const initial = [{ doctorId: "one", current: null }, { doctorId: "two", current: null }];
    const next = [{ doctorId: "one", current: current("patient-one") }, { doctorId: "two", current: current("patient-two") }];
    assert.deepEqual(newlyCalled(next, callSignatures(initial)).map(row => row.doctorId), ["one", "two"]);
    assert.deepEqual(newlyCalled(next, callSignatures(next)), []);
  });
  it("detects repeat calls of the same appointment and ignores completion", () => {
    const previous = callSignatures([{ doctorId: "one", current: current("same") }]);
    assert.equal(newlyCalled([{ doctorId: "one", current: current("same", "second") }], previous).length, 1);
    assert.deepEqual(newlyCalled([{ doctorId: "one", current: null }], previous), []);
  });
  it("does not announce stale calls on initial load or a newly assigned doctor", () => {
    assert.deepEqual(newlyCalled([{ doctorId: "one", current: current("patient") }], new Map()), []);
  });
});

describe("assistant admission requests", () => {
  const present = (id: string, status = "CONFIRMED") => ({ id, status, arrivedAt: "now" }) as Appointment;
  const queue = { date: "2026-10-25", awaitingAssistant: true, current: null, ordered: [present("absent"), present("first"), present("second", "LATE")] };
  queue.ordered[0].arrivedAt = null;
  it("selects the first present patient in server order for each doctor independently", () => {
    assert.equal(admissionCandidate(queue, queue.date)?.id, "first");
    assert.equal(admissionCandidate({ ...queue, ordered: [present("other-doctor")] }, queue.date)?.id, "other-doctor");
  });
  it("never offers admission without a live request, with an occupied doctor or on another day", () => {
    assert.equal(admissionCandidate({ ...queue, awaitingAssistant: false }, queue.date), null);
    assert.equal(admissionCandidate({ ...queue, current: present("inside", "IN_PROGRESS") }, queue.date), null);
    assert.equal(admissionCandidate(queue, "2026-10-26"), null);
  });
  it("does not invent a candidate when order or attendance is missing", () => {
    assert.equal(admissionCandidate({ ...queue, ordered: undefined }, queue.date), null);
    assert.equal(admissionCandidate({ ...queue, ordered: [present("done", "COMPLETED")] }, queue.date), null);
  });
});
