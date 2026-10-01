import { safeErrorCode } from "./safeError";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * مزامنة متابعات خطط الأسنان (DentalFollowUp) مع حالة موعد العودة المرتبط بها.
 *
 *  - موعد العودة أُلغي (CANCELLED) أو اعتُمد غيابًا (NO_SHOW) → تعود المتابعة إلى DUE ويُفكّ ربط الموعد
 *    (لا تُحذف أبدًا)، فيستطيع الطبيب برمجة موعد آخر لها.
 *  - موعد العودة اكتمل (COMPLETED) → تصبح المتابعة COMPLETED.
 *
 * لا تُعتبر المتابعة مكتملة بمجرد حجز الموعد (تبقى SCHEDULED). لا يُمسّ إلا ما هو SCHEDULED فعلًا، فالتكرار آمن.
 * الإلغاء محروس أيضًا بـtrigger في قاعدة البيانات (migration 20260930120000) لأي مسار خارج الخادم.
 */
export type FollowUpSyncStatus = "CANCELLED" | "NO_SHOW" | "COMPLETED";

export async function syncDentalFollowUps(
  appointmentIds: string[],
  status: FollowUpSyncStatus,
  db: Prisma.TransactionClient = prisma,
  now: Date = new Date()
): Promise<number> {
  if (appointmentIds.length === 0) return 0;
  if (status === "COMPLETED") {
    const r = await db.dentalFollowUp.updateMany({
      where: { appointmentId: { in: appointmentIds }, status: "SCHEDULED" },
      data: { status: "COMPLETED", completedAt: now },
    });
    return r.count;
  }
  const r = await db.dentalFollowUp.updateMany({
    where: { appointmentId: { in: appointmentIds }, status: "SCHEDULED" },
    data: { status: "DUE", appointmentId: null },
  });
  return r.count;
}

/** نسخة لا ترمي استثناءً: فشل المزامنة لا يجوز أن يُفشل تغيير حالة موعد محفوظ. */
export async function syncDentalFollowUpsSafe(appointmentIds: string[], status: FollowUpSyncStatus): Promise<void> {
  try {
    await syncDentalFollowUps(appointmentIds, status);
  } catch (err) {
    console.error("تعذّرت مزامنة متابعات خطط العلاج:", safeErrorCode(err));
  }
}
