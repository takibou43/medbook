import { AppointmentStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { resolveActingDoctorId } from "../../lib/actingDoctor";

/**
 * تقييم الطبيب من طرف المريض — نظام واحد فقط (جدول reviews الموجود، واحد لكل موعد):
 *   - المريض صاحب الموعد وحده، وبعد اكتمال الموعد (COMPLETED) وحده، ومرة واحدة لكل موعد.
 *   - الطبيب يُشتق من الموعد نفسه (appointment.doctorId) لا من الطلب، فلا يمكن تقييم طبيب غير مرتبط بالموعد.
 *   - لا يوجد أي مسار تعديل: التقييم نهائي. الإدارة وحدها تستطيع حذفه (إشراف، انظر admin.service).
 *   - القيد الفريد على reviews.appointmentId خط الدفاع الأخير ضد التكرار (طلبان متزامنان ⇒ 201 + 409).
 */

export const COMMENT_MAX = 1000;

/** نص التعليق بعد التنقية: مسافات الأطراف تُحذف، والفارغ = بلا تعليق (null). */
export function normalizeComment(comment: unknown): string | null {
  if (typeof comment !== "string") return null;
  const trimmed = comment.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** دالة نقية: هل الموعد قابل للتقييم من طرف هذا المريض؟ تعيد سبب الرفض أو null. */
export function reviewEligibilityError(
  appointment: { patientId: string | null; status: AppointmentStatus; hasReview: boolean },
  patientId: string
): { status: 403 | 400 | 409; message: string } | null {
  if (appointment.patientId !== patientId) return { status: 403, message: "لا يمكنك تقييم موعد ليس لك." };
  if (appointment.status !== AppointmentStatus.COMPLETED) return { status: 400, message: "لا يمكن التقييم إلا بعد اكتمال الموعد." };
  if (appointment.hasReview) return { status: 409, message: "لقد قمت بتقييم هذا الموعد مسبقًا." };
  return null;
}

/** متوسط مقرّب لخانة عشرية واحدة (0 إن لم توجد تقييمات). */
export function roundAverage(avg: number | null | undefined): number {
  if (avg == null || !Number.isFinite(avg)) return 0;
  return Math.round(avg * 10) / 10;
}

/**
 * يعيد حساب متوسط/عدد تقييمات الطبيب المخزَّنين في جدول doctors من جدول reviews نفسه (مصدر الحقيقة).
 * يُستدعى داخل معاملة بعد قفل صف الطبيب (FOR UPDATE)، فتقييمان متزامنان للطبيب نفسه لا يكتب أحدهما
 * متوسطًا قديمًا فوق الآخر.
 */
export async function recalcDoctorRating(tx: Prisma.TransactionClient, doctorId: string) {
  const agg = await tx.review.aggregate({ where: { doctorId }, _avg: { rating: true }, _count: { rating: true } });
  await tx.doctor.update({
    where: { id: doctorId },
    data: { avgRating: agg._avg.rating ?? 0, reviewsCount: agg._count.rating },
  });
}

export async function lockDoctorRow(tx: Prisma.TransactionClient, doctorId: string) {
  await tx.$queryRaw`SELECT id FROM "doctors" WHERE id = ${doctorId} FOR UPDATE`;
}

/**
 * إنشاء تقييم — مسموح فقط إن كان لدى المريض موعد بحالة COMPLETED مع هذا الطبيب
 * ولم يسبق له تقييم ذلك الموعد تحديدًا.
 */
export async function createReview(patientUserId: string, appointmentId: string, rating: number, comment?: string | null) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw ApiError.badRequest("التقييم يجب أن يكون بين 1 و5.");
  const text = normalizeComment(comment);
  if (text && text.length > COMMENT_MAX) throw ApiError.badRequest(`التعليق يجب ألا يتجاوز ${COMMENT_MAX} حرف.`);

  const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
  if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض.");

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { review: { select: { id: true } } } });
  if (!appointment) throw ApiError.notFound("الموعد غير موجود.");
  const denied = reviewEligibilityError(
    { patientId: appointment.patientId, status: appointment.status, hasReview: Boolean(appointment.review) },
    patient.id
  );
  if (denied) throw new ApiError(denied.status, denied.message);

  try {
    return await prisma.$transaction(async (tx) => {
      await lockDoctorRow(tx, appointment.doctorId);
      // إعادة التحقق داخل المعاملة: الحالة قد تتغيّر بين القراءة الأولى والكتابة.
      const fresh = await tx.appointment.findUnique({ where: { id: appointmentId }, select: { status: true, patientId: true } });
      if (!fresh || fresh.patientId !== patient.id || fresh.status !== AppointmentStatus.COMPLETED) {
        throw ApiError.badRequest("لا يمكن التقييم إلا بعد اكتمال الموعد.");
      }
      const review = await tx.review.create({
        data: { appointmentId, doctorId: appointment.doctorId, patientId: patient.id, rating, comment: text },
        select: { id: true, appointmentId: true, doctorId: true, rating: true, comment: true, createdAt: true },
      });
      await recalcDoctorRating(tx, appointment.doctorId);
      return review;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw ApiError.conflict("لقد قمت بتقييم هذا الموعد مسبقًا.");
    }
    throw err;
  }
}

/** اسم عرض آمن للعموم: الاسم الأول + الحرف الأول من اللقب فقط. */
export function maskLastName(lastName: string | null | undefined): string {
  const first = (lastName ?? "").trim().charAt(0);
  return first ? `${first}.` : "";
}

/** قائمة عامة (صفحة الطبيب): بلا معرّفات داخلية للمريض أو الموعد، واللقب مختصر. */
export async function listForDoctor(doctorId: string) {
  const rows = await prisma.review.findMany({
    where: { doctorId },
    select: { id: true, doctorId: true, rating: true, comment: true, createdAt: true, patient: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => ({ ...r, patient: { firstName: r.patient.firstName, lastName: maskLastName(r.patient.lastName) } }));
}

/** توزيع النجوم 1..5 من نتيجة groupBy. */
export function buildDistribution(groups: { rating: number; count: number }[]): Record<"1" | "2" | "3" | "4" | "5", number> {
  const dist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const g of groups) {
    const key = String(g.rating) as keyof typeof dist;
    if (key in dist) dist[key] += g.count;
  }
  return dist;
}

/**
 * تقييمات الطبيب الحالي (لوحة الطبيب) — الطبيب يُشتق من الجلسة فقط، لا من الطلب.
 * قراءة فقط: لا يوجد أي مسار يسمح للطبيب بتعديل تقييم أو حذفه.
 */
export async function listForCurrentDoctor(userId: string, role: Role, page = 1, pageSize = 20) {
  const doctorId = await resolveActingDoctorId(userId, role);
  const size = Math.min(50, Math.max(1, Math.floor(pageSize) || 20));
  const current = Math.max(1, Math.floor(page) || 1);

  const [agg, groups, withComment, rows] = await Promise.all([
    prisma.review.aggregate({ where: { doctorId }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.review.groupBy({ by: ["rating"], where: { doctorId }, _count: { _all: true } }),
    prisma.review.count({ where: { doctorId, comment: { not: null } } }),
    prisma.review.findMany({
      where: { doctorId },
      orderBy: { createdAt: "desc" },
      skip: (current - 1) * size,
      take: size,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        patient: { select: { firstName: true, lastName: true } },
        appointment: { select: { date: true, startTime: true } },
      },
    }),
  ]);

  const total = agg._count._all;
  return {
    summary: {
      avgRating: roundAverage(agg._avg.rating),
      reviewsCount: total,
      withCommentCount: withComment,
      distribution: buildDistribution(groups.map((g) => ({ rating: g.rating, count: g._count._all }))),
    },
    items: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      appointmentDate: r.appointment.date,
      appointmentTime: r.appointment.startTime,
      patientName: [r.patient.firstName, maskLastName(r.patient.lastName)].filter(Boolean).join(" "),
    })),
    page: current,
    pageSize: size,
    total,
    totalPages: Math.max(1, Math.ceil(total / size)),
  };
}
