/**
 * قواعد نقية لخطط العلاج وموعد العودة (بلا قاعدة بيانات) — تُختبر مباشرة.
 */

export type PlanStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

/** الخطة النشطة وحدها تُعدَّل أو تُغلق؛ المكتملة والملغاة نهائيتان (للقراءة فقط). */
export function canTransitionPlan(from: PlanStatus, to: PlanStatus): boolean {
  return from === "ACTIVE" && (to === "COMPLETED" || to === "CANCELLED");
}

/** نفس المستفيد؟ (null = صاحب الحساب نفسه). */
export function sameBeneficiary(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * مستفيد موعد العودة:
 *  - requested === undefined → نفس مستفيد الموعد الأصلي (لا تغيير ضمني).
 *  - requested === null      → صاحب الحساب نفسه (اختيار صريح).
 *  - requested = معرّف       → فرد العائلة المختار صراحةً (تُفحص ملكيته في الخدمة).
 */
export function resolveFollowUpBeneficiary(originalFamilyMemberId: string | null, requested: string | null | undefined): string | null {
  if (requested === undefined) return originalFamilyMemberId ?? null;
  return requested;
}

/**
 * «بعد N أشهر» من تاريخ (منتصف ليل UTC ليوم التقويم). يُقصّ آخر الشهر: 31 يناير + 1 شهر = 28/29 فبراير.
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const d = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay)));
}

/** أقصى أفق لموعد عودة يبرمجه الطبيب (أبعد من أفق حجز المريض 60 يومًا، لأن المتابعة قد تكون بعد 6 أشهر). */
export const FOLLOW_UP_HORIZON_DAYS = 400;

export function withinFollowUpHorizon(date: Date, today: Date): boolean {
  const last = today.getTime() + (FOLLOW_UP_HORIZON_DAYS - 1) * 86_400_000;
  return date.getTime() >= today.getTime() && date.getTime() <= last;
}

/** نص إشعار المريض بموعد العودة (بلا سبب طبي). */
export function followUpNotificationText(p: {
  doctorName: string;
  date: string;
  startTime: string;
  beneficiaryName?: string | null;
}): string {
  const forWhom = p.beneficiaryName ? ` لـ${p.beneficiaryName}` : " لك";
  return `برمج${forWhom} الدكتور ${p.doctorName} موعد عودة يوم ${p.date} على الساعة ${p.startTime}.`;
}
