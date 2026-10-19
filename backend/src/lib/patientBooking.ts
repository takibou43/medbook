import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';

export const PATIENT_DAILY_BOOKING_LIMIT = 3;

/** Must run in the same transaction as creation; each family beneficiary has a separate quota. */
export async function createPatientAppointment<T extends Prisma.AppointmentCreateArgs>(
  tx: Prisma.TransactionClient, args: Prisma.SelectSubset<T, Prisma.AppointmentCreateArgs>,
): Promise<Prisma.AppointmentGetPayload<T>> {
  const data = args.data as Prisma.AppointmentUncheckedCreateInput;
  if (data.patientId && data.createdBy === 'PATIENT') {
    const date = new Date(data.date);
    const familyMemberId = data.familyMemberId ?? null;
    const key = ['patient-booking', data.patientId, familyMemberId ?? 'self', data.doctorId, date.toISOString().slice(0, 10)].join(':');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const active = await tx.appointment.count({ where: {
      patientId: data.patientId, familyMemberId, doctorId: data.doctorId, date, createdBy: 'PATIENT',
      status: { in: ['PENDING', 'CONFIRMED', 'LATE', 'IN_PROGRESS', 'RESCHEDULE_REQUIRED'] },
    } });
    if (active >= PATIENT_DAILY_BOOKING_LIMIT) throw ApiError.conflict(
      'يمكنك حجز حتى 3 مواعيد نشطة لكل مستفيد لدى الطبيب في اليوم. اختر يومًا آخر أو ألغِ موعدًا غير مطلوب.',
      { code: 'PATIENT_BOOKING_LIMIT' },
    );
  }
  return tx.appointment.create(args) as Promise<Prisma.AppointmentGetPayload<T>>;
}
