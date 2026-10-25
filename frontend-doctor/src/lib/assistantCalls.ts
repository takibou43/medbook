import type { Appointment } from "../types";

export type AssistantCurrent = { doctorId: string; current: Appointment | null };
export function callSignatures(rows: AssistantCurrent[]) {
  return new Map(rows.map(row => [row.doctorId, row.current ? `${row.current.id}:${row.current.calledAt ?? ""}` : null]));
}
export function newlyCalled(rows: AssistantCurrent[], previous: Map<string, string | null>) {
  return rows.filter(row => row.current && previous.has(row.doctorId) && previous.get(row.doctorId) !== `${row.current.id}:${row.current.calledAt ?? ""}`);
}

/** Use the server order only; the admission endpoint rechecks it under its doctor lock. */
export function admissionCandidate<T extends Appointment>(queue: { date: string; awaitingAssistant?: boolean; current: Appointment | null; ordered?: T[] }, today: string): T | null {
  if (queue.date.slice(0, 10) !== today || !queue.awaitingAssistant || queue.current) return null;
  return queue.ordered?.find(a => Boolean(a.arrivedAt) && (a.status === "CONFIRMED" || a.status === "LATE")) ?? null;
}
