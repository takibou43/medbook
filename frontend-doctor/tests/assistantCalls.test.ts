import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Appointment } from "../src/types/index.ts";
import { callSignatures, newlyCalled } from "../src/lib/assistantCalls.ts";
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
