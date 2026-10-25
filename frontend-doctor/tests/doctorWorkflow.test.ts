import test from "node:test";
import assert from "node:assert/strict";
import { awaitingAssistantAdmission, filterQueue, hasUnprintedVisitDraft } from "../src/lib/doctorWorkflow.ts";
import { emptyDraft, prescriptionPatientFrom } from "../src/lib/prescription.ts";
import type { Appointment } from "../src/types/index.ts";

const visit = (id: string, name: string, phone: string) => ({ id, date: "2026-10-24", startTime: "10:00", guestFirstName: name, guestLastName: "", guestPhone: phone, patientId: null }) as unknown as Appointment;
const first = visit("a", "أحمد", "0550 123 456");
const second = visit("b", "Karim", "0660123456");

test("queue search preserves server order, identities and input", () => {
  const queue = [second, first];
  assert.equal(filterQueue(queue, ""), queue);
  assert.deepEqual(filterQueue(queue, "123"), [second, first]);
  assert.deepEqual(filterQueue(queue, "احمد"), [first]);
  assert.deepEqual(filterQueue(queue, "٠٥٥٠ ١٢٣"), [first]);
  assert.deepEqual(filterQueue(queue, "kARIM"), [second]);
  assert.deepEqual(filterQueue(queue, "absent"), []);
  assert.deepEqual(queue, [second, first]);
});

test("completion warning is scoped to an unprinted draft of the same visit", () => {
  const draft = emptyDraft("doctor", prescriptionPatientFrom(first), "current");
  assert.equal(hasUnprintedVisitDraft(null, first), false);
  assert.equal(hasUnprintedVisitDraft(draft, first), false);
  draft.notes = "تعليمات";
  assert.equal(hasUnprintedVisitDraft(draft, first), true);
  assert.equal(hasUnprintedVisitDraft(draft, second), false);
  draft.printedAt = new Date().toISOString();
  assert.equal(hasUnprintedVisitDraft(draft, first), false);
  draft.printedAt = undefined;
  assert.equal(hasUnprintedVisitDraft(draft, first), true);
});

test("admission stays pending only while an assistant may still handle it", () => {
  const requested = { awaitingAssistant: true, current: null };
  assert.equal(awaitingAssistantAdmission(requested, true), true);
  assert.equal(awaitingAssistantAdmission(requested, undefined), true);
  // The doctor can use next-call themselves after the assistant ends their shift.
  assert.equal(awaitingAssistantAdmission(requested, false), false);
  assert.equal(awaitingAssistantAdmission({ ...requested, current: first }, true), false);
  assert.equal(awaitingAssistantAdmission({ ...requested, awaitingAssistant: false }, true), false);
  assert.equal(awaitingAssistantAdmission(undefined, true), false);
});
