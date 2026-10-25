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
