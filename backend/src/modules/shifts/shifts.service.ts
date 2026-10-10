import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { lockDoctorCalls } from "../../lib/doctorLock";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../lib/audit";
import { algeriaTodayUTCMidnight, ALGERIA_OFFSET_MINUTES, closingTimeForDate } from "../../lib/slots";

export async function hasOnDutyAssistant(doctorId: string, db: Prisma.TransactionClient = prisma) {
  const doctor = await db.doctor.findUniqueOrThrow({ where: { id: doctorId }, select: { clinicId: true } });
  return !!await db.assistant.findFirst({ where: {
    isActive: true, user: { isActive: true }, shiftEndsAt: { gt: new Date() },
    OR: [{ doctorId, clinicId: null }, ...(doctor.clinicId ? [{ clinicId: doctor.clinicId,
      OR: [{ allDoctors: true }, { allDoctors: false, allowedDoctorIds: { has: doctorId } }] }] : [])],
  }, select: { id: true } });
}

export async function assertReception(userId: string, role: Role, doctorId: string, db: Prisma.TransactionClient = prisma) {
  if (role === Role.ASSISTANT) {
    const assistant = await db.assistant.findUnique({ where: { userId } });
    if (!assistant?.isActive || !assistant.shiftEndsAt || assistant.shiftEndsAt <= new Date())
      throw ApiError.forbidden("ابدأ المناوبة أولًا.");
  } else if (role !== Role.DOCTOR || await hasOnDutyAssistant(doctorId, db)) {
    throw ApiError.forbidden("تأكيد الحضور والإدخال مسؤولية المساعد الموجود في المناوبة.");
  }
}

export async function shiftState(userId: string, role: Role) {
  const doctorId = await resolveActingDoctorId(userId, role);
  const doctor = await prisma.doctor.findUniqueOrThrow({ where: { id: doctorId }, include: { schedules: true } });
  const assistant = role === Role.ASSISTANT ? await prisma.assistant.findUniqueOrThrow({ where: { userId } }) : null;
  const endsAt = assistant ? assistant.shiftEndsAt : doctor.dutyEndsAt;
  return { active: !!endsAt && endsAt > new Date(), endsAt,
    suggestedEndTime: closingTimeForDate(algeriaTodayUTCMidnight(), doctor.schedules),
    hasActiveAssistant: await hasOnDutyAssistant(doctorId) };
}

export async function setShift(userId: string, role: Role, endTime: string | null) {
  const doctorId = await resolveActingDoctorId(userId, role);
  let endsAt: Date | null = null;
  if (endTime !== null) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw ApiError.badRequest("حدد وقت نهاية صحيحًا.");
    const [h, m] = endTime.split(":").map(Number);
    endsAt = new Date(algeriaTodayUTCMidnight().getTime() + ((h * 60 + m) - ALGERIA_OFFSET_MINUTES) * 60000);
    if (endsAt <= new Date()) throw ApiError.badRequest("نهاية المناوبة يجب أن تكون لاحقًا اليوم.");
  }
  await prisma.$transaction(async tx => {
    await lockDoctorCalls(tx, doctorId);
    if (role === Role.DOCTOR) await tx.doctor.update({ where: { id: doctorId }, data: { dutyEndsAt: endsAt, queueRequestedAt: null } });
    else await tx.assistant.update({ where: { userId }, data: { shiftEndsAt: endsAt } });
    await writeAudit({ userId, action: endsAt ? "SHIFT_STARTED" : "SHIFT_ENDED", entity: role, meta: { doctorId, endsAt: endsAt?.toISOString() ?? null } }, tx);
  });
  return shiftState(userId, role);
}
