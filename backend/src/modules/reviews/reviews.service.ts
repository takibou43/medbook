import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";

async function recalcDoctorRating(doctorId: string) {
  const agg = await prisma.review.aggregate({ where: { doctorId }, _avg: { rating: true }, _count: { rating: true } });
  await prisma.doctor.update({
    where: { id: doctorId },
    data: { avgRating: agg._avg.rating ?? 0, reviewsCount: agg._count.rating },
  });
}

/**
 * إنشاء تقييم — مسموح فقط إن كان لدى المريض موعد بحالة COMPLETED مع هذا الطبيب
 * ولم يسبق له تقييم ذلك الموعد تحديدًا.
 */
export async function createReview(patientUserId: string, appointmentId: string, rating: number, comment?: string) {
  if (rating < 1 || rating > 5) throw ApiError.badRequest("التقييم يجب أن يكون بين 1 و5.");

  const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
  if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض.");

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { review: true } });
  if (!appointment) throw ApiError.notFound("الموعد غير موجود.");
  if (appointment.patientId !== patient.id) throw ApiError.forbidden("لا يمكنك تقييم موعد ليس لك.");
  if (appointment.status !== AppointmentStatus.COMPLETED) {
    throw ApiError.badRequest("لا يمكن التقييم إلا بعد اكتمال الموعد.");
  }
  if (appointment.review) throw ApiError.conflict("لقد قمت بتقييم هذا الموعد مسبقًا.");

  const review = await prisma.review.create({
    data: { appointmentId, doctorId: appointment.doctorId, patientId: patient.id, rating, comment },
  });

  await recalcDoctorRating(appointment.doctorId);
  return review;
}

export async function listForDoctor(doctorId: string) {
  return prisma.review.findMany({
    where: { doctorId },
    include: { patient: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });
}
