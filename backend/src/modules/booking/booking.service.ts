import { AppointmentStatus, Prisma, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { generateAvailableSlots, isWithinWorkingHours, isPast } from "../../lib/slots";
import { createNotification } from "../notifications/notifications.service";
import { GuestBookingInput, GuestSlotsQuery } from "./booking.schema";

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

async function findCandidateDoctors(wilayaId: string, specialtyId: string) {
  return prisma.doctor.findMany({
    where: { wilayaId, specialtyId, verificationStatus: VerificationStatus.VERIFIED },
    include: { schedules: true },
    orderBy: [{ avgRating: "desc" }, { reviewsCount: "desc" }],
  });
}

async function bookedRangesForDoctorOnDate(doctorId: string, date: Date) {
  const startOfDay = new Date(date);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return prisma.appointment.findMany({
    where: {
      doctorId,
      date: { gte: startOfDay, lte: endOfDay },
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
    },
    select: { startTime: true, endTime: true },
  });
}

export async function getAggregatedSlots(query: GuestSlotsQuery) {
  const date = new Date(query.date + "T00:00:00");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");

  const doctors = await findCandidateDoctors(query.wilayaId, query.specialtyId);
  if (doctors.length === 0) return [];

  const slotSet = new Set<string>();
  for (const doctor of doctors) {
    const booked = await bookedRangesForDoctorOnDate(doctor.id, date);
    const slots = generateAvailableSlots(date, doctor.schedules, booked, SLOT_MINUTES);
    for (const s of slots) {
      if (!isPast(date, s)) slotSet.add(s);
    }
  }

  return Array.from(slotSet).sort();
}
export async function createGuestAppointment(input: GuestBookingInput) {
  const date = new Date(input.date + "T00:00:00");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");

  if (isPast(date, input.startTime)) {
    throw ApiError.badRequest("لا يمكن الحجز في وقت مضى.");
  }

  const endTime = addMinutes(input.startTime, SLOT_MINUTES);

  if (input.doctorId) {
    const doctor = await prisma.doctor.findUnique({ where: { id: input.doctorId }, include: { schedules: true } });
    if (!doctor || doctor.verificationStatus !== VerificationStatus.VERIFIED) {
      throw ApiError.notFound("الطبيب غير موجود أو غير موثّق.");
    }
    if (!isWithinWorkingHours(date, input.startTime, endTime, doctor.schedules)) {
      throw ApiError.badRequest("هذا الوقت خارج أوقات عمل الطبيب.");
    }

    const booked = await bookedRangesForDoctorOnDate(doctor.id, date);
    const availableSlots = generateAvailableSlots(date, doctor.schedules, booked, SLOT_MINUTES);
    if (!availableSlots.includes(input.startTime)) {
      throw ApiError.conflict("هذا الوقت لم يعد متاحًا لدى هذا الطبيب. الرجاء اختيار وقت آخر.");
    }

    try {
      const appointment = await prisma.appointment.create({
        data: {
          patientId: null,
          guestFirstName: input.firstName,
          guestLastName: input.lastName,
          guestPhone: input.phone || null,
          doctorId: doctor.id,
          date,
          startTime: input.startTime,
          endTime,
          status: AppointmentStatus.PENDING,
          notes: input.notes,
        },
        include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
      });

      await createNotification(
        doctor.userId,
        "APPOINTMENT_CREATED",
        "طلب حجز موعد جديد",
        `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} (بدون حساب) بتاريخ ${input.date} الساعة ${input.startTime}.`
      );

      return appointment;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw ApiError.conflict("تم حجز هذه الفترة للتو من طرف مستخدم آخر. الرجاء اختيار وقت آخر.");
      }
      throw err;
    }
  }

  const doctors = await findCandidateDoctors(input.wilayaId, input.specialtyId);
  if (doctors.length === 0) {
    throw ApiError.notFound("لا يوجد طبيب متاح بهذا التخصص في هذه الولاية حاليًا.");
  }

  for (const doctor of doctors) {
    if (!isWithinWorkingHours(date, input.startTime, endTime, doctor.schedules)) continue;

    const booked = await bookedRangesForDoctorOnDate(doctor.id, date);
    const availableSlots = generateAvailableSlots(date, doctor.schedules, booked, SLOT_MINUTES);
    if (!availableSlots.includes(input.startTime)) continue;

    try {
      const appointment = await prisma.appointment.create({
        data: {
          patientId: null,
          guestFirstName: input.firstName,
          guestLastName: input.lastName,
          guestPhone: input.phone || null,
          doctorId: doctor.id,
          date,
          startTime: input.startTime,
          endTime,
          status: AppointmentStatus.PENDING,
          notes: input.notes,
        },
        include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
      });

      await createNotification(
        doctor.userId,
        "APPOINTMENT_CREATED",
        "طلب حجز موعد جديد",
        `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} (بدون حساب) بتاريخ ${input.date} الساعة ${input.startTime}.`
      );

      return appointment;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  throw ApiError.conflict("هذا الوقت لم يعد متاحًا لدى أي طبيب مطابق. الرجاء اختيار وقت آخر.");
}
