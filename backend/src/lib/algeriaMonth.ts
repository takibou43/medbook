/**
 * حدود «الشهر الميلادي الحالي» بتوقيت الجزائر (Africa/Algiers).
 *
 * الجزائر على UTC+1 طوال السنة (لا توقيت صيفي منذ 1981)، وهو نفس الافتراض المستعمل في كل MadBook
 * (lib/slots.ts → ALGERIA_OFFSET_MINUTES). نحسب اللحظات بالـUTC لمقارنتها بعمود createdAt (timestamp UTC).
 *
 * مثال: 2026-09-30T23:30Z = 2026-10-01 00:30 بتوقيت الجزائر → الفترة "2026-10".
 * دالة نقية (بلا قاعدة بيانات ولا Date.now داخلية) — تُختبر بوقت ثابت.
 */
export const ALGERIA_UTC_OFFSET_MS = 60 * 60 * 1000;

export interface AlgeriaMonthRange {
  /** أول لحظة من الشهر بتوقيت الجزائر، معبَّرًا عنها بـUTC (شاملة). */
  start: Date;
  /** أول لحظة من الشهر التالي بتوقيت الجزائر، بـUTC (غير شاملة). */
  end: Date;
  /** "YYYY-MM" حسب تقويم الجزائر. */
  period: string;
}

export function algeriaMonthRange(now: Date): AlgeriaMonthRange {
  const local = new Date(now.getTime() + ALGERIA_UTC_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - ALGERIA_UTC_OFFSET_MS);
  const end = new Date(Date.UTC(y, m + 1, 1) - ALGERIA_UTC_OFFSET_MS);
  const period = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end, period };
}

/** "YYYY-MM-DD" لتاريخ اليوم بتوقيت الجزائر. */
export function algeriaDateString(now: Date): string {
  return new Date(now.getTime() + ALGERIA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}
