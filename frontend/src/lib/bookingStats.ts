import type { BookingStats } from "../types/index.ts";

/**
 * بطاقة عدّاد الحجوزات: النص يأتي جاهزًا من الخادم (رقم فعلي ≥ 10، أو عبارة عامة للأعداد الصغيرة،
 * أو دعوة للحجز عند الصفر) — الواجهة لا تضع أي رقم ثابت ولا تقرّب ولا تضيف «+».
 * عند الفشل أو التحميل أو ردّ غير متوقع: البطاقة تُخفى فقط، والحجز لا يتأثر أبدًا.
 */
export function counterCardText(state: { data?: BookingStats | null; isError?: boolean; isLoading?: boolean }): string | null {
  if (state.isError || state.isLoading || !state.data) return null;
  const text = typeof state.data.displayText === "string" ? state.data.displayText.trim() : "";
  if (!text) return null;
  // حارس إضافي: لا نعرض رقمًا دقيقًا صغيرًا حتى لو وصل خطأً من الخادم.
  if (state.data.displayCount !== null && state.data.displayCount < 10) return null;
  return text;
}
