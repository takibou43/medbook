import type { Appointment } from "../types/index.ts";
import { appointmentPhone, beneficiaryName } from "./appointmentPeople.ts";
import { draftHasContent, samePrescriptionVisit, type PrescriptionDraft } from "./prescription.ts";

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f\u064b-\u065f\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).toLocaleLowerCase();
}

/** Filter only the displayed queue; preserve server order and appointment identities. */
export function filterQueue(queue: Appointment[], query: string): Appointment[] {
  const term = normalize(query.trim());
  if (!term) return queue;
  const phone = term.replace(/[^0-9]/g, "");
  return queue.filter(a => normalize(beneficiaryName(a)).includes(term) ||
    (phone.length > 0 && /^[+\d\s().-]+$/.test(term) && normalize(appointmentPhone(a) ?? "").replace(/[^0-9]/g, "").includes(phone)));
}

export function hasUnprintedVisitDraft(draft: PrescriptionDraft | null, appointment: Appointment): boolean {
  return Boolean(draft && !draft.printedAt && samePrescriptionVisit(draft.patient, appointment) && draftHasContent(draft));
}

/** A pending request must not block the doctor after the assistant ends their shift. */
export function awaitingAssistantAdmission(queue: { awaitingAssistant?: boolean; current: Appointment | null } | undefined, hasActiveAssistant: boolean | undefined): boolean {
  return Boolean(queue?.awaitingAssistant && !queue.current && hasActiveAssistant !== false);
}

/** Select from server order without allowing an unarrived or finished visit to be called. */
export function nextPresentPatient(queue: Appointment[]): Appointment | undefined {
  return queue.find(a => Boolean(a.arrivedAt) && (a.status === "CONFIRMED" || a.status === "LATE"));
}

/** A request to reception is not an admission; derive feedback from the actual response. */
export function callNextMessage(result: unknown): string {
  return result && typeof result === "object" && "awaitingAssistant" in result && result.awaitingAssistant === true
    ? "تم إرسال الطلب إلى المساعد. يبدأ الكشف بعد تأكيد إدخال المريض."
    : "تمت مناداة المريض التالي.";
}

/** Only the server's first present patient may be admitted; assistants also need a doctor request. */
export function canConfirmAdmission(queue: { current: Appointment | null; awaitingAssistant?: boolean; ordered: Appointment[] }, id: string, isAssistant: boolean): boolean {
  return !queue.current && (!isAssistant || queue.awaitingAssistant === true) && nextPresentPatient(queue.ordered)?.id === id;
}
