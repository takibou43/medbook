import { recordArrival } from "../../lib/recordArrival";
import { AppointmentStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { algeriaTodayUTCMidnight } from "../../lib/slots";
import { lockDoctorCalls } from "../../lib/doctorLock";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { liveUpdates } from "../../lib/liveUpdates";
import { z } from "zod";
import { signArrivalCode, verifyArrivalCode } from '../../lib/arrivalCode';

export const arrivalInput = z.object({
  code: z.string().max(160).refine(code => verifyArrivalCode(code) !== null, 'كود الحضور قديم أو غير صالح. اطلب مسح الملصق الجديد من العيادة.'),
  appointmentId: z.string().uuid().optional(),
}).strict();

export async function arrivalPoster(userId: string, role: Role) {
  const id = await resolveActingDoctorId(userId, role);
  const doctor = await prisma.doctor.findUniqueOrThrow({ where: { id }, select: { id: true, firstName: true, lastName: true, clinicId: true, clinic: { select: { nameAr: true } } } });
  return { doctorId: doctor.id, code: signArrivalCode(doctor.clinicId ? 'clinic' : 'doctor', doctor.clinicId ?? doctor.id), name: doctor.clinic?.nameAr ?? doctor.firstName + ' ' + doctor.lastName };
}

export async function scanArrival(userId: string, input: z.infer<typeof arrivalInput>) {
  const verified = verifyArrivalCode(input.code);
  if (!verified) throw ApiError.badRequest('كود الحضور قديم أو غير صالح. اطلب الملصق الجديد من العيادة.');
  const { kind, id } = verified;
  const patient = await prisma.patient.findUnique({ where: { userId }, select: { id: true } });
  if (!patient) throw ApiError.forbidden();
  const where: Prisma.AppointmentWhereInput = {
    patientId: patient.id, date: algeriaTodayUTCMidnight(),
    doctor: kind === 'clinic' ? { clinicId: id } : { id },
    status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.LATE, AppointmentStatus.IN_PROGRESS] },
  };
  const candidates = await prisma.appointment.findMany({ where, orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    select: { id: true, doctorId: true, startTime: true, familyMemberId: true, familyMember: { select: { firstName: true, lastName: true } },
      doctor: { select: { firstName: true, lastName: true } } } });
  if (!candidates.length) {
    if (input.appointmentId) throw ApiError.notFound('الموعد غير موجود.');
    return { bookingRequired: true, bookingPath: kind === 'doctor' ? '/?doctor=' + encodeURIComponent(id) + '&intent=booking' : '/clinics/' + encodeURIComponent(id) };
  }
  if (!input.appointmentId && (candidates.length > 1 || candidates[0].familyMemberId)) return { choices: candidates };
  const chosen = candidates.find(a => a.id === (input.appointmentId ?? candidates[0].id));
  if (!chosen) throw ApiError.notFound('الموعد غير موجود.');
  const result = await prisma.$transaction(async tx => {
    await lockDoctorCalls(tx, chosen.doctorId);
    const appointment = await tx.appointment.findFirst({ where: { ...where, id: chosen.id } });
    if (!appointment) throw ApiError.conflict('تغيرت حالة الموعد. أعد المسح.');
    if (appointment.arrivedAt || appointment.status === AppointmentStatus.IN_PROGRESS) return { arrivedAt: appointment.arrivedAt, alreadyArrived: true };
    const arrivedAt = await recordArrival(tx, appointment, userId);
    return { arrivedAt, alreadyArrived: false };
  });
  liveUpdates.publish([chosen.doctorId]);
  return { ...result, appointmentId: chosen.id };
}
