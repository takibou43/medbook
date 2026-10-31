import test from "node:test";
import assert from "node:assert/strict";
import { callNextMessage, canConfirmAdmission, awaitingAssistantAdmission, filterQueue, hasUnprintedVisitDraft, nextPresentPatient } from "../src/lib/doctorWorkflow.ts";
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

test("next call skips unarrived patients and preserves server priority after QR or assistant arrival", () => {
  const absent = { ...first, status: "CONFIRMED", arrivedAt: null } as Appointment;
  const present = { ...second, status: "LATE", arrivedAt: "2026-10-29T09:00:00Z" } as Appointment;
  const later = { ...present, id: "c", status: "CONFIRMED" } as Appointment;
  assert.equal(nextPresentPatient([]), undefined);
  assert.equal(nextPresentPatient([absent]), undefined);
  assert.equal(nextPresentPatient([absent, present, later]), present);
  const arrived = { ...absent, arrivedAt: "2026-10-29T09:01:00Z" };
  assert.equal(nextPresentPatient([arrived, present]), arrived);
  assert.equal(nextPresentPatient([{ ...arrived, status: "COMPLETED" }, present]), present);
  assert.equal(nextPresentPatient([{ ...arrived, status: "CANCELLED" }]), undefined);
});


test("admission controls follow the first present patient and the doctor-assistant handshake", () => {
  const absent = { ...first, status: "CONFIRMED", arrivedAt: null } as Appointment;
  const present = { ...second, status: "LATE", arrivedAt: "now" } as Appointment;
  const later = { ...present, id: "later" };
  const queue = { current: null, awaitingAssistant: false, ordered: [absent, present, later] };
  assert.equal(canConfirmAdmission(queue, present.id, false), true);
  assert.equal(canConfirmAdmission(queue, absent.id, false), false);
  assert.equal(canConfirmAdmission(queue, later.id, false), false);
  assert.equal(canConfirmAdmission(queue, present.id, true), false);
  const requested = { ...queue, awaitingAssistant: true };
  assert.equal(canConfirmAdmission(requested, present.id, true), true);
  assert.equal(canConfirmAdmission(requested, later.id, true), false);
  const earlierArrival = { ...absent, arrivedAt: "now" };
  assert.equal(canConfirmAdmission({ ...requested, ordered: [earlierArrival, present] }, present.id, true), false);
  assert.equal(canConfirmAdmission({ ...requested, current: present }, present.id, true), false);
  assert.equal(canConfirmAdmission({ ...queue, ordered: [] }, present.id, false), false);
});

test("call feedback distinguishes a reception request from actual admission", () => {
  assert.equal(callNextMessage({ awaitingAssistant: true }), "تم إرسال الطلب إلى المساعد. يبدأ الكشف بعد تأكيد إدخال المريض.");
  assert.equal(callNextMessage({ ...first, status: "IN_PROGRESS" }), "تمت مناداة المريض التالي.");
});
