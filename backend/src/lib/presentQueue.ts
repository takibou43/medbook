import { AppointmentStatus } from "@prisma/client";

/** Admission priority is the original appointment time, never a lateness penalty. */
export function firstPresent<T extends { id: string; startTime: string; status: string; arrivedAt: Date | string | null; urgencyStatus?: string }>(rows: T[]): T | null {
  return rows.filter(a => a.arrivedAt && (a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.LATE))
    .sort((a, b) => Number(b.urgencyStatus === "APPROVED") - Number(a.urgencyStatus === "APPROVED") || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id))[0] ?? null;
}

/** Present patients first; absent patients retain their original appointment order. */
export function presentQueueOrder<T extends { id: string; startTime: string; arrivedAt?: Date | string | null; urgencyStatus?: string }>(rows: T[]): T[] {
  return [...rows].sort((a,b) => Number(!!b.arrivedAt) - Number(!!a.arrivedAt) || Number(b.urgencyStatus === "APPROVED") - Number(a.urgencyStatus === "APPROVED") || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
}
