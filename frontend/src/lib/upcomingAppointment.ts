import type { MyAppointment } from "../types/index.ts";

const ACTIVE = new Set(["PENDING", "CONFIRMED", "IN_PROGRESS", "LATE", "RESCHEDULE_REQUIRED"]);

export function upcomingAppointment(appointments: MyAppointment[], now = Date.now()): MyAppointment | undefined {
  const today = new Date(now + 3_600_000).toISOString().slice(0, 10);
  return appointments.filter(a => ACTIVE.has(a.status) && a.date.slice(0, 10) >= today)
    .sort((a, b) => (a.date.slice(0, 10) + a.startTime).localeCompare(b.date.slice(0, 10) + b.startTime))[0];
}
