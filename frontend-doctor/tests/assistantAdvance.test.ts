import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceAfterMissedCall } from "../src/lib/assistantAdvance.ts";
import type { Appointment } from "../src/types/index.ts";
const a = (id: string) => ({ id, doctorId: "doctor-one" } as Appointment);
test("defer first, then use server order and never recall the skipped patient", async () => {
  const steps: string[] = [];
  const result = await advanceAfterMissedCall("skipped", {
    defer: async () => { steps.push("defer"); },
    queue: async () => { steps.push("queue"); return { current: null, ordered: [a("skipped"), a("next"), a("other")], waiting: [], late: [] }; },
    call: async id => { steps.push(id); return a(id); },
  });
  assert.deepEqual(steps, ["defer", "queue", "next"]); assert.equal(result.kind, "called");
});
test("failed deferral never calls anyone", async () => {
  await assert.rejects(advanceAfterMissedCall("skipped", {
    defer: async () => { throw Error("cannot defer"); },
    queue: async () => { assert.fail("must not load next queue"); },
    call: async () => { assert.fail("must not call next"); },
  }), /cannot defer/);
});
test("no other patient leaves original deferred, without immediately recalling them", async () => {
  const result = await advanceAfterMissedCall("skipped", {
    defer: async () => {}, queue: async () => ({ current: null, ordered: [a("skipped")], waiting: [], late: [a("skipped")] }), call: async () => { assert.fail("no other patient"); },
  }); assert.deepEqual(result, { kind: "empty" });
});
test("an existing current call is preserved, including concurrent calls by another operator", async () => {
  const result = await advanceAfterMissedCall("skipped", {
    defer: async () => {}, queue: async () => ({ current: a("already-called"), waiting: [a("next")], late: [] }), call: async () => { assert.fail("must not replace current call"); },
  }); assert.deepEqual(result, { kind: "current", appointment: a("already-called") });
});
test("failed next call offers a retry that does not repeat deferral", async () => {
  let deferrals = 0, calls = 0;
  const requests = {
    defer: async () => { deferrals++; },
    queue: async () => ({ current: null, ordered: [a("next")], waiting: [], late: [] }),
    call: async (id: string) => { calls++; if (calls === 1) throw Error("network"); return a(id); },
  };
  assert.equal((await advanceAfterMissedCall("skipped", requests)).kind, "retry");
  assert.equal((await advanceAfterMissedCall("skipped", requests, true)).kind, "called");
  assert.equal(deferrals, 1); assert.equal(calls, 2);
});
test("uncertain call result: retry reads current before calling, avoiding a second patient", async () => {
  const result = await advanceAfterMissedCall("skipped", {
    defer: async () => { assert.fail("already deferred"); },
    queue: async () => ({ current: a("next"), waiting: [a("third")], late: [] }),
    call: async () => { assert.fail("first call already succeeded"); },
  }, true); assert.equal(result.kind, "current");
});
