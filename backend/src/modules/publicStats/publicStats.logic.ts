/**
 * منطق عدّاد الحجوزات العلني — دوال نقية (بلا قاعدة بيانات) تُختبر مباشرة.
 *
 * التعريف الدقيق (definition = NON_CANCELLED_CREATED_THIS_MONTH):
 *   عدد صفوف appointments التي أُنشئت (createdAt) خلال الشهر الميلادي الحالي بتوقيت الجزائر
 *   [أول الشهر 00:00 ، أول الشهر التالي 00:00) وحالتها الحالية ليست CANCELLED.
 *   - لا يعتمد على عدد المرضى ولا التقييمات، ولا تقريب ولا مضاعف تسويقي.
 *   - مع wilayaId: مواعيد أطباء تلك الولاية فقط (Doctor.wilayaId)، وإلا العدد الوطني.
 *   - موعد أُنشئ هذا الشهر ثم أُلغي لاحقًا يخرج من العدد (الحالة الحالية هي المرجع).
 *
 * الخصوصية: 1–9 لا يُعرض رقمها الدقيق للعامة (displayCount = null، و count = null أيضًا في الرد العام)
 * حتى لا يكشف رقم صغير في ولاية صغيرة نشاط أفراد بعينهم. 0 لا يُعرض كـ«0 حجز» بل دعوة عادية للحجز.
 */

export const STATS_DEFINITION = "NON_CANCELLED_CREATED_THIS_MONTH" as const;
export const MIN_PUBLIC_COUNT = 10;

export interface BookingCounterDisplay {
  /** العدد الدقيق للعامة، أو null حين يكون بين 1 و 9 (خصوصية). */
  count: number | null;
  displayCount: number | null;
  displayText: string;
  /** للواجهة: هل تستحق البطاقة الظهور بصيغة «رقم»؟ */
  level: "NONE" | "LOW" | "NUMBER";
}

// صيغة العدد مع المعدود بالعربية (موعد/موعدان/مواعيد/موعدًا) — أرقام لاتينية لتطابق بقية الواجهة.
export function arabicAppointmentsCount(n: number): string {
  if (n === 1) return "موعد واحد";
  if (n === 2) return "موعدان";
  const mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) return `${n} مواعيد`;
  // 100، 101، 102، 200... → «موعد» (تمييز مفرد مجرور بعد المئة والألف).
  if (n >= 100 && mod100 <= 2) return `${n} موعد`;
  return `${n} موعدًا`;
}

export function buildCounterDisplay(count: number, wilayaName?: string | null): BookingCounterDisplay {
  const where = wilayaName ? ` في ولاية ${wilayaName}` : "";
  if (!Number.isFinite(count) || count <= 0) {
    return {
      count: 0,
      displayCount: null,
      displayText: wilayaName ? `احجز موعدك الآن مع أطباء ولاية ${wilayaName} عبر MedBook` : "احجز موعدك الآن عبر MedBook",
      level: "NONE",
    };
  }
  if (count < MIN_PUBLIC_COUNT) {
    return {
      count: null,
      displayCount: null,
      displayText: `بدأ المرضى بالحجز عبر MedBook هذا الشهر${where}`,
      level: "LOW",
    };
  }
  return {
    count,
    displayCount: count,
    displayText: `تم حجز ${arabicAppointmentsCount(count)} هذا الشهر${where}`,
    level: "NUMBER",
  };
}
