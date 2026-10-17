import { Prisma } from '@prisma/client';
import { followUpAnchorFor } from './queuePriority';
import { withNearTurnFlags } from './queueNotified';
import { writeAudit } from './audit';
import { algeriaTodayUTCMidnight } from './slots';

/** Caller holds lockDoctorCalls and validates ownership, day and status. */
export async function recordArrival(tx: Prisma.TransactionClient, appointment: { id: string; doctorId: string; arrivedAt: Date | null; isFollowUp: boolean; status?: string }, userId: string) {
  if (appointment.arrivedAt) return appointment.arrivedAt;
  let followUpAnchorId: string | undefined;
  if (appointment.isFollowUp && appointment.status === "CONFIRMED") {
    const waiting = await tx.appointment.findMany({ where: { doctorId: appointment.doctorId, date: algeriaTodayUTCMidnight(), status: { in: ['CONFIRMED', 'LATE'] } } });
    followUpAnchorId = followUpAnchorFor(await withNearTurnFlags(tx, waiting), appointment.id);
  }
  const arrivedAt = new Date();
  await tx.appointment.update({ where: { id: appointment.id }, data: { arrivedAt, skipCredits: 0, ...(followUpAnchorId ? { followUpAnchorId } : {}) } });
  await writeAudit({ userId, action: 'PATIENT_ARRIVED', entity: 'Appointment', entityId: appointment.id }, tx);
  return arrivedAt;
}
