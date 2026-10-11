import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "../utils/ApiError";
import { lockDoctorQueue } from "./doctorLock";

type Db = Prisma.TransactionClient | typeof prisma;

export const DOCTOR_HAS_ASSISTANT_MESSAGE = "لا يمكنك إنشاء موعد أثناء وجود مساعد مسؤول عن الحجوزات.";

/**
 * مصدر واحد للإجابة عن: «هل لدى هذا الطبيب مساعد فعلي الآن؟».
 *
 * المساعد الفعلي = سجل Assistant بـ isActive=true وحساب مستخدمه فعّال، وهو إما:
 *  - مساعد مستقل (clinicId فارغ) مرتبط بهذا الطبيب مباشرة، أو
 *  - مساعد عيادة يغطّي هذا الطبيب (allDoctors أو ضمن allowedDoctorIds) وطبيبنا ما زال في العيادة نفسها.
 * الدعوات المعلّقة أو الملغاة أو المنتهية، والمساعد المعطّل، والسجل المحذوف: لا تُحتسب.
 * نفس منطق assistantDoctorWhere/resolveActingDoctorId حتى لا يختلف تعريف «المساعد» بين الحجز والصلاحيات.
 */
export async function doctorHasActiveAssistant(doctorId: string, db: Db = prisma): Promise<boolean> {
  const doctor = await db.doctor.findUnique({ where: { id: doctorId }, select: { clinicId: true } });
  if (!doctor) return false;
  const scope: Prisma.AssistantWhereInput[] = [{ clinicId: null, doctorId }];
  if (doctor.clinicId) {
    scope.push({ clinicId: doctor.clinicId, OR: [{ allDoctors: true }, { allowedDoctorIds: { has: doctorId } }] });
  }
  const row = await db.assistant.findFirst({
    where: { isActive: true, user: { isActive: true }, OR: scope },
    select: { id: true },
  });
  return row !== null;
}

/**
 * يرفض (403) إنشاء موعد من حساب الطبيب إن كان لديه مساعد فعلي. يُستدعى داخل معاملة الحجز بعد
 * lockDoctorQueue، وعمليات تفعيل المساعد/قبول الدعوة تأخذ القفل نفسه، فلا يمرّ طلب بين قراءة الحالة والكتابة.
 */
export async function assertDoctorMayCreateAppointments(doctorId: string, db: Db = prisma): Promise<void> {
  if (await doctorHasActiveAssistant(doctorId, db)) throw ApiError.forbidden(DOCTOR_HAS_ASSISTANT_MESSAGE);
}

/**
 * أي عملية تضيف مساعدًا أو تفعّله أو توسّع نطاقه تأخذ قفل طابور كل طبيب متأثر (نفس قفل الحجز)، مرتبًا
 * بالمعرّف لتفادي التشابك. حاجز الحجز يقرأ المساعدين بعد أخذ القفل نفسه، فيرى الحالة الملتزَمة قبله أو بعده،
 * ولا يمرّ طلب حجز بين «لا مساعد» و«مساعد جديد». يُحرَّر القفل عند commit/rollback.
 */
export async function lockDoctorsForAssistantChange(tx: Prisma.TransactionClient, doctorIds: string[]): Promise<void> {
  for (const id of [...new Set(doctorIds)].sort()) await lockDoctorQueue(tx, id);
}

/** كل أطباء العيادة (للمساعد الذي نطاقه عيادة كاملة أو أطباء محددون) — نقفل الجميع لأن النطاق قابل للتغيّر. */
export async function clinicDoctorIds(tx: Prisma.TransactionClient, clinicId: string): Promise<string[]> {
  const rows = await tx.doctor.findMany({ where: { clinicId }, select: { id: true } });
  return rows.map((r) => r.id);
}
