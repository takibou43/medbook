import { AppointmentStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { generateAvailableSlots, isWithinWorkingHours, isPast, algeriaTodayUTCMidnight, closingTimeForDate } from "../../lib/slots";
import { createNotification } from "../notifications/notifications.service";
import { CreateAppointmentInput } from "./appointments.schema";

const SLOT_MINUTES = 20;

function addMinutes(hhmm: string, minutes: number): string {
    const [h, m] = hhmm.split(":").map(Number);
    const total = h * 60 + m + minutes;
    const nh = Math.floor(total / 60)
      .toString()
      .padStart(2, "0");
    const nm = (total % 60).toString().padStart(2, "0");
    return `${nh}:${nm}`;
}

export async function createAppointment(patientUserId: string, input: CreateAppointmentInput) {
    const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
    if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض مرتبط بهذا الحساب.");

  const doctor = await prisma.doctor.findUnique({ where: { id: input.doctorId }, include: { schedules: true } });
    if (!doctor) throw ApiError.notFound("الطبيب غير موجود.");
    if (doctor.verificationStatus !== "VERIFIED") {
          throw ApiError.badRequest("لا يمكن حجز موعد مع طبيب لم يتم التحقق منه بعد.");
    }

  const date = new Date(input.date + "T00:00:00Z");
    if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");

  if (isPast(date, input.startTime)) {
        throw ApiError.badRequest("لا يمكن الحجز في وقت مضى.");
  }

  const endTime = addMinutes(input.startTime, SLOT_MINUTES);

  if (!isWithinWorkingHours(date, input.startTime, endTime, doctor.schedules)) {
        throw ApiError.badRequest("هذا الوقت خارج أوقات عمل الطبيب.");
  }

  const startOfDay = new Date(date);
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

  const bookedForDay = await prisma.appointment.findMany({
        where: { doctorId: doctor.id, date: { gte: startOfDay, lte: endOfDay }, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] } },
        select: { startTime: true, endTime: true },
  });

  const availableSlots = generateAvailableSlots(date, doctor.schedules, bookedForDay, SLOT_MINUTES);
    if (!availableSlots.includes(input.startTime)) {
          throw ApiError.conflict("هذه الفترة محجوزة مسبقًا أو غير متاحة. الرجاء اختيار فترة أخرى.");
    }

  try {
        const appointment = await prisma.appointment.create({
                data: {
                          patientId: patient.id,
                          doctorId: doctor.id,
                          date,
                          startTime: input.startTime,
                          endTime,
                          type: input.type,
                          status: AppointmentStatus.PENDING,
                          notes: input.notes,
                          services: input.serviceIds
                            ? { create: input.serviceIds.map((serviceId) => ({ serviceId })) }
                            : undefined,
                },
                include: { doctor: true, patient: true, services: { include: { service: true } } },
        });

      await createNotification(
              doctor.userId,
              "APPOINTMENT_CREATED",
              "طلب حجز موعد جديد",
              `لديك طلب حجز جديد من ${appointment.patient!.firstName} ${appointment.patient!.lastName} بتاريخ ${input.date} الساعة ${input.startTime}.`
            );

      return appointment;
  } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
                throw ApiError.conflict("تم حجز هذه الفترة للتو من طرف مستخدم آخر. الرجاء اختيار فترة أخرى.");
        }
        throw err;
  }
}

export async function listForPatient(patientUserId: string, status?: AppointmentStatus) {
    const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
    if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض مرتبط بهذا الحساب.");

  return prisma.appointment.findMany({
        where: { patientId: patient.id, ...(status ? { status } : {}) },
                    include: { doctor: { include: { specialty: true, clinic: true } }, review: true },
        orderBy: { date: "desc" },
  });
}

export async function autoExpireStaleAppointments(doctorId: string) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { schedules: true } });
    if (!doctor) return;

  const candidates = await prisma.appointment.findMany({
        where: { doctorId, status: AppointmentStatus.CONFIRMED, date: { lte: algeriaTodayUTCMidnight() } },
        select: { id: true, date: true },
  });
    if (candidates.length === 0) return;

  const toExpire = candidates
      .filter((a) => {
              const closing = closingTimeForDate(a.date, doctor.schedules);
              return closing ? isPast(a.date, closing) : isPast(a.date, "23:59");
      })
      .map((a) => a.id);

  if (toExpire.length > 0) {
        await prisma.appointment.updateMany({ where: { id: { in: toExpire } }, data: { status: AppointmentStatus.NO_SHOW } });
  }
}

export async function listForDoctor(doctorUserId: string, status?: AppointmentStatus, dateStr?: string) {
    const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
    if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");

  await autoExpireStaleAppointments(doctor.id);

  const dateFilter = dateStr
      ? (() => {
                const d = new Date(dateStr + "T00:00:00Z");
                const end = new Date(d);
                end.setUTCHours(23, 59, 59, 999);
                return { gte: d, lte: end };
      })()
        : undefined;

  return prisma.appointment.findMany({
        where: { doctorId: doctor.id, ...(status ? { status } : {}), ...(dateFilter ? { date: dateFilter } : {}) },
        include: { patient: { include: { user: { select: { email: true, phone: true } } } } },
        orderBy: { date: "asc" },
  });
}

export const ALLOWED_TRANSITIONS: Record<Role, Partial<Record<AppointmentStatus, AppointmentStatus[]>>> = {
    PATIENT: {
          PENDING: ["CANCELLED"],
          CONFIRMED: ["CANCELLED"],
    },
    DOCTOR: {
          PENDING: ["CONFIRMED", "CANCELLED"],
          CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
    },
    ADMIN: {
          PENDING: ["CONFIRMED", "CANCELLED"],
          CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
          COMPLETED: [],
          CANCELLED: [],
          NO_SHOW: [],
    },
};

export function canTransition(role: Role, from: AppointmentStatus, to: AppointmentStatus): boolean {
    const allowedNext = ALLOWED_TRANSITIONS[role]?.[from] ?? [];
    return allowedNext.includes(to);
}

export async function updateStatus(userId: string, role: Role, appointmentId: string, newStatus: AppointmentStatus) {
    const appointment = await prisma.appointment.findUnique({
          where: { id: appointmentId },
          include: { doctor: true, patient: true },
    });
    if (!appointment) throw ApiError.notFound("الموعد غير موجود.");

  if (role === "PATIENT" && appointment.patient?.userId !== userId) throw ApiError.forbidden();
    if (role === "DOCTOR" && appointment.doctor.userId !== userId) throw ApiError.forbidden();

  if (!canTransition(role, appointment.status, newStatus)) {
        throw ApiError.badRequest(`لا يمكن تغيير حالة الموعد من ${appointment.status} إلى ${newStatus}.`);
  }

  const updated = await prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: newStatus },
        include: { doctor: true, patient: true },
  });

  const notifyMap: Partial<Record<AppointmentStatus, { userId: string | undefined; title: string; message: string; type: any }>> = {
        CONFIRMED: {
                userId: updated.patient?.userId,
                title: "تم تأكيد موعدك",
                type: "APPOINTMENT_CONFIRMED",
                message: `تم تأكيد موعدك مع د. ${updated.doctor.firstName} ${updated.doctor.lastName} بتاريخ ${updated.date.toISOString().slice(0, 10)} الساعة ${updated.startTime}.`,
        },
        CANCELLED: {
                userId: role === "PATIENT" ? updated.doctor.userId : updated.patient?.userId,
                title: "تم إلغاء الموعد",
                type: "APPOINTMENT_CANCELLED",
                message: `تم إلغاء الموعد بتاريخ ${updated.date.toISOString().slice(0, 10)} الساعة ${updated.startTime}.`,
        },
        COMPLETED: {
                userId: updated.patient?.userId,
                title: "اكتمل موعدك",
                type: "APPOINTMENT_COMPLETED",
                message: `تم إنهاء موعدك مع د. ${updated.doctor.firstName} ${updated.doctor.lastName}. يمكنك الآن تقييم الطبيب.`,
        },
        NO_SHOW: {
                userId: updated.patient?.userId,
                title: "لم تحضر إلى موعدك",
                type: "APPOINTMENT_NO_SHOW",
                message: `تم تسجيل عدم حضورك للموعد بتاريخ ${updated.date.toISOString().slice(0, 10)}.`,
        },
  };

  const notif = notifyMap[newStatus];
    if (notif && notif.userId) await createNotification(notif.userId, notif.type, notif.title, notif.message);

  return updated;
}

export async function cancelByPatient(patientUserId: string, appointmentId: string) {
    return updateStatus(patientUserId, "PATIENT", appointmentId, AppointmentStatus.CANCELLED);
}
