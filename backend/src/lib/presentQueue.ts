import { orderQueue, type QueueOrderRow } from "./queuePriority";

/**
 * واجهة الترتيب القديمة محفوظة (الاسمان presentQueueOrder وfirstPresent يستعملهما كل الكود القائم)،
 * لكن المنطق كله صار في الدالة المركزية lib/queuePriority.ts — لا نسخة ثانية للترتيب في أي مكان.
 * Admission priority is the original appointment time, never a lateness penalty.
 */
export function presentQueueOrder<T extends QueueOrderRow>(rows: T[]): T[] {
  return orderQueue(rows);
}

/** أول مريض حاضر (CONFIRMED/LATE) بحسب الترتيب المركزي نفسه — هو من تتم مناداته. */
export function firstPresent<T extends QueueOrderRow & { status: string; arrivedAt: Date | string | null }>(rows: T[]): T | null {
  const present = rows.filter((a) => a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE"));
  return orderQueue(present)[0] ?? null;
}
