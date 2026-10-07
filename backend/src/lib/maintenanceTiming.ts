import { prisma } from "./prisma";
import { nextTrialDelay, quietCheckDelay } from "./backgroundTiming";
import { algeriaTimeOnDay } from "./doctorQueue";
import { closingTimeForDate } from "./slots";
import { listAppointmentExpiryCandidates } from "../modules/appointments/appointments.service";

/** Keep clinical deadlines precise; the hourly fallback is only for quiet periods. */
export async function nextMaintenanceDelay(now = new Date()): Promise<number> {
  const [trialDelay, notification, doctors] = await Promise.all([
    nextTrialDelay(now),
    prisma.notification.findFirst({
      where: { expiresAt: { not: null } },
      select: { expiresAt: true }, orderBy: { expiresAt: "asc" },
    }),
    listAppointmentExpiryCandidates(now),
  ]);
  let delay = Math.min(quietCheckDelay(now), trialDelay);
  // Remaining overdue work can mean a transient failure. Retry within a minute,
  // not in a tight loop and not after a full quiet hour.
  const include = (deadline: number) => {
    const remaining = deadline - now.getTime();
    delay = Math.min(delay, remaining <= 0 ? 60_000 : remaining);
  };
  if (notification?.expiresAt) include(notification.expiresAt.getTime());
  for (const doctor of doctors) {
    const day = doctor.appointments[0]?.date;
    if (day) include(algeriaTimeOnDay(day, closingTimeForDate(day, doctor.schedules) ?? "23:59").getTime() + 1);
  }
  return Math.max(1000, delay);
}
