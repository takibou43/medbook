import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";

export async function getDoctorByUserId(userId: string) {
  const doctor = await prisma.doctor.findUnique({ where: { userId } });
  if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
  return doctor;
}

export async function updateOwnProfile(
  userId: string,
  data: Partial<{
    bio: string;
    yearsExperience: number;
    languages: string[];
    consultationFee: number;
    phone: string;
    address: string;
    photoUrl: string;
    clinicId: string;
  }>
) {
  const doctor = await getDoctorByUserId(userId);
  return prisma.doctor.update({ where: { id: doctor.id }, data });
}

export async function getWeeklySchedule(userId: string) {
  const doctor = await getDoctorByUserId(userId);
  return prisma.doctorSchedule.findMany({ where: { doctorId: doctor.id }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] });
}

export async function replaceWeeklySchedule(
  userId: string,
  blocks: { dayOfWeek: number; startTime: string; endTime: string }[]
) {
  const doctor = await getDoctorByUserId(userId);
  await prisma.$transaction([
    prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id, isException: false } }),
    prisma.doctorSchedule.createMany({
      data: blocks.map((b) => ({ doctorId: doctor.id, dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime })),
    }),
  ]);
  return getWeeklySchedule(userId);
}

export async function addScheduleException(
  userId: string,
  exception: { exceptionDate: string; isOff: boolean; startTime?: string; endTime?: string }
) {
  const doctor = await getDoctorByUserId(userId);
  return prisma.doctorSchedule.create({
    data: {
      doctorId: doctor.id,
      isException: true,
      exceptionDate: new Date(exception.exceptionDate + "T00:00:00"),
      isOff: exception.isOff,
      startTime: exception.startTime ?? "00:00",
      endTime: exception.endTime ?? "23:59",
    },
  });
}

export async function removeScheduleBlock(userId: string, blockId: string) {
  const doctor = await getDoctorByUserId(userId);
  const block = await prisma.doctorSchedule.findUnique({ where: { id: blockId } });
  if (!block || block.doctorId !== doctor.id) throw ApiError.notFound("العنصر غير موجود.");
  await prisma.doctorSchedule.delete({ where: { id: blockId } });
}

export async function getDashboardStats(userId: string) {
  const doctor = await getDoctorByUserId(userId);
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));

  const [todayCount, upcomingCount, completedCount, cancelledCount, patientsCount] = await Promise.all([
    prisma.appointment.count({ where: { doctorId: doctor.id, date: { gte: startOfDay, lte: endOfDay } } }),
    prisma.appointment.count({
      where: { doctorId: doctor.id, date: { gt: endOfDay }, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] } },
    }),
    prisma.appointment.count({ where: { doctorId: doctor.id, status: AppointmentStatus.COMPLETED } }),
    prisma.appointment.count({ where: { doctorId: doctor.id, status: AppointmentStatus.CANCELLED } }),
    prisma.appointment.findMany({ where: { doctorId: doctor.id }, distinct: ["patientId"], select: { patientId: true } }),
  ]);

  return {
    todayAppointments: todayCount,
    upcomingAppointments: upcomingCount,
    completedAppointments: completedCount,
    cancelledAppointments: cancelledCount,
    totalPatients: patientsCount.length,
    avgRating: doctor.avgRating,
    reviewsCount: doctor.reviewsCount,
    verificationStatus: doctor.verificationStatus,
  };
}

export async function getOwnPatients(userId: string) {
  const doctor = await getDoctorByUserId(userId);
  const appointments = await prisma.appointment.findMany({
    where: { doctorId: doctor.id },
    include: { patient: { include: { user: { select: { email: true, phone: true } } } } },
    orderBy: { date: "desc" },
  });

  const map = new Map<string, any>();
  for (const a of appointments) {
    if (!map.has(a.patientId)) {
      map.set(a.patientId, {
        patientId: a.patientId,
        firstName: a.patient.firstName,
        lastName: a.patient.lastName,
        email: a.patient.user.email,
        phone: a.patient.user.phone,
        lastVisit: a.date,
        totalAppointments: 1,
      });
    } else {
      map.get(a.patientId).totalAppointments += 1;
    }
  }
  return Array.from(map.values());
}
