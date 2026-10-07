import { AppointmentStatus, ReminderStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { algeriaDayOf, appointmentStartUtc } from "../modules/reminders/reminders.service";

// Align quiet jobs to one hourly window, rather than waking Neon at staggered times.
const QUIET_CHECK_MS = 60 * 60_000;
export function quietCheckDelay(now: Date): number {
  return QUIET_CHECK_MS - (now.getTime() % QUIET_CHECK_MS);
}
export function reminderDelay(starts: Date[], pending: Date | null, now: Date, intervalMs: number) {
  const earliest = Math.min(...starts.map(start => start.getTime() - 2 * 60 * 60_000), pending?.getTime() ?? Infinity);
  return Math.max(intervalMs, Math.min(quietCheckDelay(now), earliest - now.getTime()));
}

export async function nextReminderDelay(intervalMs: number, now = new Date()) {
  const [appointments, pending] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId: { not: null }, date: { gte: algeriaDayOf(now) },
        status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.LATE] } },
      select: { date: true, startTime: true }, orderBy: [{ date: "asc" }, { startTime: "asc" }], take: 1,
    }),
    prisma.appointmentReminder.findFirst({ where: { status: ReminderStatus.PENDING },
      select: { scheduledFor: true }, orderBy: { scheduledFor: "asc" } }),
  ]);
  return reminderDelay(appointments.map(a => appointmentStartUtc(a.date, a.startTime)), pending?.scheduledFor ?? null, now, intervalMs);
}

export async function nextTrialDelay(now = new Date()) {
  const next = await prisma.doctor.findFirst({
    where: { subscriptionStatus: SubscriptionStatus.ACTIVE, subscriptionExpiresAt: { gte: now } },
    select: { subscriptionExpiresAt: true }, orderBy: { subscriptionExpiresAt: "asc" },
  });
  return Math.max(1000, Math.min(quietCheckDelay(now), (next?.subscriptionExpiresAt?.getTime() ?? Infinity) - now.getTime() + 1));
}
