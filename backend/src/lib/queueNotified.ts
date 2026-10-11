import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * حماية المرضى المنبَّهين من أولوية موعد العودة: المصدر سجل التنبيه المحفوظ (AppointmentReminder من نوع
 * QUEUE_APPROACH) لا افتراض أن الإشعار وصل أو قُرئ. SENT = أُرسل فعلًا. PROCESSING = حُجز للإرسال الآن
 * (احتياطًا: قد يصل خلال لحظات). PENDING/SKIPPED/FAILED = لم يصل تنبيه فلا حماية.
 * (القيم نصوص ReminderStatus حرفيًا ليبقى الملف قابلًا للاختبار بلا عميل Prisma مُولَّد.)
 */
export const NEAR_TURN_PROTECTED_STATUSES = ["SENT", "PROCESSING"] as const;

type Db = PrismaClient | Prisma.TransactionClient;

/** يضيف nearTurnNotified لكل صف بقراءة واحدة من القاعدة. */
export async function withNearTurnFlags<T extends { id: string }>(db: Db, rows: T[]): Promise<Array<T & { nearTurnNotified: boolean }>> {
  if (rows.length === 0) return [];
  const notified = await db.appointmentReminder.findMany({
    where: {
      appointmentId: { in: rows.map((r) => r.id) },
      type: "QUEUE_APPROACH",
      status: { in: [...NEAR_TURN_PROTECTED_STATUSES] },
    },
    select: { appointmentId: true },
  });
  const set = new Set(notified.map((n) => n.appointmentId));
  return rows.map((r) => ({ ...r, nearTurnNotified: set.has(r.id) }));
}
