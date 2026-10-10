import { AppointmentStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { lockDoctorCalls } from "../../lib/doctorLock";
import { algeriaTodayUTCMidnight } from "../../lib/slots";
import { writeAudit } from "../../lib/audit";
import { ApiError } from "../../utils/ApiError";
import { assertReception } from "../shifts/shifts.service";

export async function requestUrgency(userId: string, role: Role, appointmentId: string, reason: string) {
  const doctorId = await resolveActingDoctorId(userId, role);
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 500) throw ApiError.badRequest("اكتب سببًا مختصرًا لا يتجاوز 500 حرف.");
  return prisma.$transaction(async tx => {
    await lockDoctorCalls(tx, doctorId);
    await assertReception(userId, role, doctorId, tx);
    const a = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!a || a.doctorId !== doctorId) throw ApiError.notFound("الموعد غير موجود.");
    if (!a.arrivedAt || a.date.getTime() !== algeriaTodayUTCMidnight().getTime() ||
      !(a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.LATE))
      throw ApiError.badRequest("طلب الاستعجال لمريض حاضر ينتظر اليوم فقط.");
    if (a.urgencyStatus !== "NONE") throw ApiError.conflict("تم إرسال أو حسم طلب الاستعجال لهذا الموعد.");
    const updated = await tx.appointment.update({ where: { id: a.id }, data: {
      urgencyStatus: "REQUESTED", urgencyReason: trimmed, urgencyRequestedAt: new Date(),
    } });
    await writeAudit({ userId, action: "URGENCY_REQUESTED", entity: "Appointment", entityId: a.id }, tx);
    return updated;
  });
}

export async function decideUrgency(userId: string, role: Role, appointmentId: string, approve: boolean) {
  if (role !== Role.DOCTOR) throw ApiError.forbidden("قرار تقديم الحالة بيد الطبيب فقط.");
  const doctorId = await resolveActingDoctorId(userId, role);
  return prisma.$transaction(async tx => {
    await lockDoctorCalls(tx, doctorId);
    const doctor = await tx.doctor.findUniqueOrThrow({ where: { id: doctorId } });
    if (!doctor.dutyEndsAt || doctor.dutyEndsAt <= new Date()) throw ApiError.badRequest("ابدأ المداومة أولًا.");
    const a = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!a || a.doctorId !== doctorId) throw ApiError.notFound("الموعد غير موجود.");
    if (a.urgencyStatus !== "REQUESTED" || !a.arrivedAt || a.date.getTime() !== algeriaTodayUTCMidnight().getTime() ||
      !(a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.LATE))
      throw ApiError.conflict("تغيّرت حالة المريض أو حُسم الطلب. حدّث القائمة.");
    const updated = await tx.appointment.update({ where: { id: a.id }, data: {
      urgencyStatus: approve ? "APPROVED" : "DECLINED", urgencyDecidedAt: new Date(), urgencyDecidedBy: userId,
    } });
    await writeAudit({ userId, action: approve ? "URGENCY_APPROVED" : "URGENCY_DECLINED", entity: "Appointment", entityId: a.id }, tx);
    return updated;
  });
}
