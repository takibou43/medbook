import { AppointmentStatus, PatientBlockType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { algeriaTodayUTCMidnight } from "../../lib/slots";

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

// ============================================================
// الحظر التلقائي بسبب تكرار الغياب
// ============================================================

/** عدد غيابات NO_SHOW داخل النافذة الذي يفعّل الحظر التلقائي. */
export const AUTO_BLOCK_NO_SHOW_LIMIT = 3;
/** طول النافذة بالأيام التقويمية (اليوم الحالي بتوقيت الجزائر + 6 أيام قبله). */
export const AUTO_BLOCK_WINDOW_DAYS = 7;

export function autoBlockReason(noShowCount: number): string {
  return `حظر تلقائي بسبب ${noShowCount} غيابات خلال ${AUTO_BLOCK_WINDOW_DAYS} أيام`;
}

/**
 * بداية نافذة الغياب: منتصف ليل (UTC) لليوم التقويمي قبل 6 أيام من اليوم الحالي بتوقيت الجزائر.
 * حقل Appointment.date يُخزَّن كتاريخ تقويمي عند 00:00 UTC، فالمقارنة gte مباشرة:
 * يوم 25 → النافذة 19..25 (7 أيام)، وغياب يوم 17 (قبل 8 أيام) لا يُحتسب.
 */
export function noShowWindowStart(today: Date = algeriaTodayUTCMidnight()): Date {
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (AUTO_BLOCK_WINDOW_DAYS - 1));
  return start;
}

/** عدد مواعيد المريض بالحالة النهائية NO_SHOW داخل النافذة (LATE/CANCELLED/COMPLETED... لا تُحتسب). */
export async function countRecentNoShows(patientId: string, today?: Date): Promise<number> {
  return prisma.appointment.count({
    where: { patientId, status: AppointmentStatus.NO_SHOW, date: { gte: noShowWindowStart(today) } },
  });
}

/**
 * يُستدعى بعد حفظ حالة NO_SHOW (زر «لم يحضر» أو الاعتماد التلقائي عند إغلاق العيادة) — لا يُستدعى
 * عند رفع الحظر، فلا حلقة حظر/رفع بدون غياب جديد.
 *
 * التزامن: يُستدعى دائمًا بعد أن يُثبَّت تحديث الموعد (commit)، فآخر فحص يجري بين طلبين متزامنين
 * يرى غيابيهما معًا — لا يضيع عدّ. وإن وصل طلبان معًا إلى الإنشاء، القيد الفريد activePatientId
 * يسمح بحظر نشط واحد فقط والآخر يأخذ P2002 فيُتجاهل بصمت.
 */
export async function evaluateAutoBlock(
  patientId: string,
  today?: Date
): Promise<{ blocked: boolean; noShowCount: number; blockId?: string }> {
  const noShowCount = await countRecentNoShows(patientId, today);
  if (noShowCount < AUTO_BLOCK_NO_SHOW_LIMIT) return { blocked: false, noShowCount };
  if (await isPatientBlocked(patientId)) return { blocked: false, noShowCount };

  const reason = autoBlockReason(noShowCount);
  let block;
  try {
    block = await prisma.patientBlock.create({
      data: {
        patientId,
        activePatientId: patientId,
        reason,
        blockType: PatientBlockType.AUTOMATIC,
        noShowCount,
        blockedBy: null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { blocked: false, noShowCount };
    }
    throw err;
  }
  // سجل العمليات: الفاعل هو النظام (userId = null). لا تفاصيل طبية ولا هوية الطبيب.
  await prisma.auditLog.create({
    data: {
      userId: null,
      action: "BLOCK_PATIENT",
      entity: "Patient",
      entityId: patientId,
      meta: {
        blockId: block.id,
        blockType: PatientBlockType.AUTOMATIC,
        reason,
        noShowCount,
        windowDays: AUTO_BLOCK_WINDOW_DAYS,
        limit: AUTO_BLOCK_NO_SHOW_LIMIT,
      },
    },
  });
  return { blocked: true, noShowCount, blockId: block.id };
}

/** غلاف آمن: فشل الحظر التلقائي لا يُفشل تسجيل الغياب نفسه (الغياب التالي يعيد التقييم). */
export async function evaluateAutoBlockSafe(patientId: string | null | undefined): Promise<void> {
  if (!patientId) return;
  try {
    await evaluateAutoBlock(patientId);
  } catch (err) {
    console.error(`تعذّر تقييم الحظر التلقائي للمريض ${patientId}:`, err);
  }
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
              { user: { phone: { contains: q } } },
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
    blockType: r.blockType,
    noShowCount: r.noShowCount,
    blockedAt: r.blockedAt,
    blockedByEmail: emailOf(r.blockedBy),
    unblockedAt: r.unblockedAt,
    unblockedByEmail: emailOf(r.unblockedBy),
    active: r.activePatientId !== null,
  }));
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
