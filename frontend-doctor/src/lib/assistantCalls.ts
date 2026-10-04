import type { Appointment } from "../types";

export type AssistantCurrent = { doctorId: string; current: Appointment | null };
export function callSignatures(rows: AssistantCurrent[]) {
  return new Map(rows.map(row => [row.doctorId, row.current ? `${row.current.id}:${row.current.calledAt ?? ""}` : null]));
}
export function newlyCalled(rows: AssistantCurrent[], previous: Map<string, string | null>) {
  return rows.filter(row => row.current && previous.has(row.doctorId) && previous.get(row.doctorId) !== `${row.current.id}:${row.current.calledAt ?? ""}`);
}
