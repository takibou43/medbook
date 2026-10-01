import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { algeriaMonthRange } from "../../lib/algeriaMonth";
import { buildCounterDisplay, STATS_DEFINITION } from "./publicStats.logic";

/**
 * عدّاد الحجوزات الشهري العام — انظر publicStats.logic.ts للتعريف الدقيق وقواعد الخصوصية.
 * لا يعيد أي اسم طبيب أو مريض أو مدينة أو تخصص: عددًا مجمّعًا فقط على مستوى الولاية أو الوطن.
 *
 * ذاكرة مؤقتة داخل العملية لمدة 60 ثانية لكل نطاق (فوق Cache-Control في الرد) حتى لا يتحول مسار عام
 * إلى حمل على قاعدة البيانات.
 */
const MEMO_TTL_MS = 60_000;
const memo = new Map<string, { at: number; value: unknown }>();

export async function countMonthlyBookings(wilayaId: string | null, now: Date = new Date()) {
  const { start, end } = algeriaMonthRange(now);
  return prisma.appointment.count({
    where: {
      createdAt: { gte: start, lt: end },
      status: { not: AppointmentStatus.CANCELLED },
      ...(wilayaId ? { doctor: { wilayaId } } : {}),
    },
  });
}

export async function getPublicBookingStats(wilayaId: string | null, now: Date = new Date()) {
  const { period } = algeriaMonthRange(now);
  const key = `${period}:${wilayaId ?? "*"}`;
  const hit = memo.get(key);
  if (hit && now.getTime() - hit.at < MEMO_TTL_MS) return hit.value;

  let wilayaName: string | null = null;
  if (wilayaId) {
    const wilaya = await prisma.wilaya.findUnique({ where: { id: wilayaId }, select: { nameAr: true } });
    if (!wilaya) throw ApiError.notFound("الولاية غير موجودة.");
    wilayaName = wilaya.nameAr;
  }

  const raw = await countMonthlyBookings(wilayaId, now);
  const display = buildCounterDisplay(raw, wilayaName);
  const value = {
    count: display.count,
    displayCount: display.displayCount,
    displayText: display.displayText,
    level: display.level,
    scope: wilayaId ? ("WILAYA" as const) : ("NATIONAL" as const),
    wilayaId,
    wilayaName,
    period,
    definition: STATS_DEFINITION,
  };
  memo.set(key, { at: now.getTime(), value });
  // تنظيف بسيط حتى لا تكبر الخريطة بلا حد (48 ولاية + الوطني × شهران كحد أقصى عمليًا).
  if (memo.size > 200) memo.clear();
  return value;
}

/** للاختبارات فقط. */
export function __clearPublicStatsMemo() {
  memo.clear();
}
