import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";

/**
 * حظر المرضى من إنشاء حجوزات جديدة.
 * الحظر لا يلمس أي موعد موجود (لا إلغاء، لا تغيير حالة، لا طابور، لا LATE/NO_SHOW، لا تذكيرات)،
 * ولا يمنع تسجيل الدخول ولا رؤية الحساب والمواعيد السابقة — فقط إنشاء حجز جديد.
 */
export const BLOCKED_BOOKING_MESSAGE =
  "حسابك محظور حاليًا ولا يمكنك إنشاء حجوزات جديدة. يرجى التواصل مع الإدارة.";

/** هل على هذا المريض حظر سارٍ؟ (patientId يأتي دائمًا من الجلسة عند الحجز، لا من الطلب) */
export async function isPatientBlocked(patientId: string): Promise<boolean> {
  const row = await prisma.patientBlock.findUnique({ where: { activePatientId: patientId }, select: { id: true } });
  return Boolean(row);
}

/** يرمي 403 إن كان المريض محظورًا. يُستدعى قبل إنشاء أي موعد. */
export async function assertPatientCanBook(patientId: string): Promise<void> {
  if (await isPatientBlocked(patientId)) throw ApiError.forbidden(BLOCKED_BOOKING_MESSAGE);
}

export async function blockPatient(patientId: string, adminUserId: string, reason?: string | null) {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!patient) throw ApiError.notFound("المريض غير موجود.");
  try {
    return await prisma.patientBlock.create({
      data: { patientId, activePatientId: patientId, reason: reason?.trim() || null, blockedBy: adminUserId },
    });
  } catch (err) {
    // القيد الفريد على activePatientId: حظر سارٍ موجود مسبقًا (أو طلب متزامن سبقه) — لا سجل مكرر.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw ApiError.conflict("هذا المريض محظور بالفعل.");
    }
    throw err;
  }
}

export async function unblockPatient(patientId: string, adminUserId: string) {
  // compare-and-swap: يغلق الحظر الساري فقط؛ طلبان متزامنان → واحد ينجح والآخر 409.
  const res = await prisma.patientBlock.updateMany({
    where: { activePatientId: patientId },
    data: { activePatientId: null, unblockedAt: new Date(), unblockedBy: adminUserId },
  });
  if (res.count === 0) throw ApiError.conflict("هذا المريض غير محظور حاليًا.");
  return prisma.patientBlock.findFirst({ where: { patientId }, orderBy: { blockedAt: "desc" } });
}

export async function listPatientBlocks(params: { status?: "active" | "all"; q?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));
  const q = params.q?.trim();
  const where: Prisma.PatientBlockWhereInput = {
    ...(params.status === "all" ? {} : { activePatientId: { not: null } }),
    ...(q
      ? {
          patient: {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { user: { email: { contains: q, mode: "insensitive" } } },
            ],
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.patientBlock.findMany({
      where,
      orderBy: { blockedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true, phone: true } } } },
      },
    }),
    prisma.patientBlock.count({ where }),
  ]);

  // بريد المسؤولين (من حظر/من ألغى) باستعلام واحد.
  const adminIds = [...new Set(rows.flatMap((r) => [r.blockedBy, r.unblockedBy]).filter((x): x is string => Boolean(x)))];
  const admins = adminIds.length
    ? await prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } })
    : [];
  const emailOf = (id: string | null) => (id ? admins.find((a) => a.id === id)?.email ?? null : null);

  const items = rows.map((r) => ({
    id: r.id,
    patientId: r.patientId,
    patientName: `${r.patient.firstName} ${r.patient.lastName}`.trim(),
    email: r.patient.user.email,
    phone: r.patient.user.phone,
    reason: r.reason,
    blockedAt: r.blockedAt,
    blockedByEmail: emailOf(r.blockedBy),
    unblockedAt: r.unblockedAt,
    unblockedByEmail: emailOf(r.unblockedBy),
    active: r.activePatientId !== null,
  }));
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
