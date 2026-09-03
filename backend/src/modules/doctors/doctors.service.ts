import { Prisma, VerificationStatus, SubscriptionStatus, AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { generateAvailableSlots, isPast } from "../../lib/slots";

export interface DoctorSearchFilters {
  specialtyId?: string;
  wilayaId?: string;
  cityId?: string;
  gender?: "MALE" | "FEMALE";
  q?: string; // free text: doctor name, specialty, city
  minRating?: number;
  page?: number;
  pageSize?: number;
}

export async function searchDoctors(filters: DoctorSearchFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 12));

  const where: Prisma.DoctorWhereInput = {
    verificationStatus: VerificationStatus.VERIFIED,
    // لا يظهر للمرضى إلا الأطباء ذوو الاشتراك المفعّل — انظر تعليق enum SubscriptionStatus
    // في schema.prisma. الأطباء المسجَّلون قبل هذه الميزة مثبَّتون على ACTIVE فلا يتأثرون.
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    ...(filters.specialtyId ? { specialtyId: filters.specialtyId } : {}),
    ...(filters.wilayaId ? { wilayaId: filters.wilayaId } : {}),
    ...(filters.cityId ? { cityId: filters.cityId } : {}),
    ...(filters.gender ? { gender: filters.gender } : {}),
    ...(filters.minRating ? { avgRating: { gte: filters.minRating } } : {}),
    ...(filters.q
      ? {
          OR: [
            { firstName: { contains: filters.q, mode: "insensitive" } },
            { lastName: { contains: filters.q, mode: "insensitive" } },
            { specialty: { nameAr: { contains: filters.q, mode: "insensitive" } } },
            { city: { nameAr: { contains: filters.q, mode: "insensitive" } } },
            { wilaya: { nameAr: { contains: filters.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.doctor.findMany({
      where,
      include: { specialty: true, wilaya: true, city: true, clinic: true },
      orderBy: [{ avgRating: "desc" }, { reviewsCount: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.doctor.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getDoctorById(id: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { id },
    include: {
      specialty: true,
      wilaya: true,
      city: true,
      clinic: true,
      schedules: true,
      reviews: {
        include: { patient: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
  if (!doctor) throw ApiError.notFound("الطبيب غير موجود.");
  return doctor;
}

export async function getDoctorAvailability(doctorId: string, dateStr: string) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, include: { schedules: true } });
  if (!doctor) throw ApiError.notFound("الطبيب غير موجود.");

  const date = new Date(dateStr + "T00:00:00Z");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");

  const startOfDay = new Date(date);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const booked = await prisma.appointment.findMany({
    where: {
      doctorId,
      date: { gte: startOfDay, lte: endOfDay },
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
    },
    select: { startTime: true, endTime: true },
  });

  const slots = generateAvailableSlots(date, doctor.schedules, booked);

  // لا تعرض فترات في الماضي (بتوقيت الجزائر) — نستعمل isPast الموحّدة بدل حساب محلي منفصل.
  const filtered = slots.filter((s) => !isPast(date, s));

  return { date: dateStr, slots: filtered };
}
