import { t } from "../i18n/locale.ts";
import type { VerificationStatus } from "../types/index.ts";

/**
 * مساعدات نقية لرأس لوحة الطبيب (شارة الاشتراك + الإجراءات السريعة). تُختبر بـnode --test.
 *
 * الخادم هو المرجع: `subscription` و`canCreateAppointments` يأتيان من GET /doctor/dashboard،
 * والمنع الحقيقي لحجز الطبيب الذي لديه مساعد في الـ Backend (403). هنا إخفاء الزر فقط وبيان سبب غيابه.
 */

export type SubscriptionKind = "CLINIC" | "TRIAL" | "ACTIVE" | "EXPIRED" | "NONE";

export interface SubscriptionSummary {
  kind: SubscriptionKind;
  active: boolean;
  clinicName: string | null;
  expiresAt: string | null;
}

export type BadgeTone = "green" | "blue" | "amber" | "red" | "slate";

export const TONE_CLASS: Record<BadgeTone, string> = {
  green: "bg-green-100 text-green-700",
  blue: "bg-sky-100 text-sky-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  slate: "bg-slate-200 text-slate-600",
};

const DAY_MS = 86400000;
/** عدد الأيام المتبقية (يُقرَّب للأعلى) أو null إن لم يكن هناك تاريخ صالح — لا نخترع مدة أبدًا. */
export function daysUntil(expiresAt: string | null | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
}

/** نهاية القريبة = أسبوع أو أقل: نغيّر اللون إلى الأصفر دون تغيير النص القصير داخل الشارة. */
export const EXPIRY_WARNING_DAYS = 7;

/** شارة مختصرة (كلمتان أو ثلاث) لرأس اللوحة. null إن لم تتوفر البيانات بعد. */
export function subscriptionBadge(summary: SubscriptionSummary | null | undefined, now = Date.now()): { label: string; tone: BadgeTone } | null {
  if (!summary) return null;
  const left = daysUntil(summary.expiresAt, now);
  const soon = summary.active && left !== null && left <= EXPIRY_WARNING_DAYS;
  switch (summary.kind) {
    case "CLINIC":
      return summary.active
        ? { label: t("ضمن اشتراك العيادة"), tone: soon ? "amber" : "blue" }
        : { label: t("اشتراك العيادة منتهٍ"), tone: "red" };
    case "TRIAL":
      return { label: t("تجربة مجانية"), tone: soon ? "amber" : "blue" };
    case "ACTIVE":
      return { label: t("اشتراك فعّال"), tone: soon ? "amber" : "green" };
    case "EXPIRED":
      return { label: t("اشتراك منتهٍ"), tone: "red" };
    default:
      return { label: t("غير مفعّل"), tone: "slate" };
  }
}

/** هل يحتاج الطبيب تنبيهًا قصيرًا (منتهٍ/غير مفعّل أو يقترب انتهاؤه)؟ وإلا لا نكرّر معلومة الاشتراك. */
export function subscriptionAlert(summary: SubscriptionSummary | null | undefined, now = Date.now()): string | null {
  if (!summary) return null;
  if (!summary.active) {
    return summary.kind === "CLINIC"
      ? t("اشتراك عيادتك غير فعّال، ولن تظهر للمرضى حتى يُجدَّد.")
      : t("اشتراكك غير فعّال، ولن تظهر للمرضى حتى يُجدَّد.");
  }
  const left = daysUntil(summary.expiresAt, now);
  if (left !== null && left <= EXPIRY_WARNING_DAYS) {
    return t("ينتهي اشتراكك بعد {0} {1}.", { "0": left, "1": left === 1 ? t("يوم") : t("أيام") });
  }
  return null;
}

export interface SubscriptionDetails {
  headline: string;
  lines: string[];
  /** يُعرض رابط «مراسلة الإدارة» للتجديد/التفعيل — لا زر دفع (لا بوابة دفع في المنصة). */
  needsAdminContact: boolean;
}

/** نصوص صفحة تفاصيل الاشتراك — صادقة: لا مدة ولا تاريخ إلا إن وُجد في السجل. */
export function subscriptionDetails(summary: SubscriptionSummary, formatDay: (isoDay: string) => string, now = Date.now()): SubscriptionDetails {
  const day = summary.expiresAt ? formatDay(summary.expiresAt.slice(0, 10)) : "";
  const left = daysUntil(summary.expiresAt, now);
  const expiry = day ? (summary.active ? t("ينتهي في {0}.", { "0": day }) : t("انتهى في {0}.", { "0": day })) : null;
  const remaining = summary.active && left !== null ? t("المتبقي: {0} {1}.", { "0": left, "1": left === 1 ? t("يوم") : t("أيام") }) : null;
  switch (summary.kind) {
    case "CLINIC":
      return {
        headline: summary.active ? t("اشتراكك مشمول في اشتراك العيادة") : t("اشتراك عيادتك غير فعّال"),
        lines: [
          summary.clinicName ? t("العيادة: {0}.", { "0": summary.clinicName }) : "",
          t("تتولى العيادة إدارة الاشتراك والدفع، ولا يُطلب منك أي دفع بشكل مستقل."),
          expiry ?? "",
          remaining ?? "",
        ].filter(Boolean),
        needsAdminContact: false,
      };
    case "TRIAL":
      return {
        headline: t("أنت في فترة تجربة مجانية"),
        lines: [expiry ?? "", remaining ?? "", t("بعد انتهائها يتوقف ظهورك للمرضى حتى التفعيل.")].filter(Boolean),
        needsAdminContact: true,
      };
    case "ACTIVE":
      return {
        headline: t("اشتراكك فعّال"),
        lines: [expiry ?? "", remaining ?? ""].filter(Boolean),
        needsAdminContact: false,
      };
    case "EXPIRED":
      return {
        headline: t("انتهى اشتراكك"),
        lines: [expiry ?? "", t("لا تظهر للمرضى ولا يُفتح الحجز معك حتى التجديد.")].filter(Boolean),
        needsAdminContact: true,
      };
    default:
      return {
        headline: t("لا يوجد اشتراك مفعّل"),
        lines: [t("لا تظهر للمرضى حتى يُفعَّل اشتراكك من الإدارة.")],
        needsAdminContact: true,
      };
  }
}

export type QuickActionId = "book" | "appointments" | "queue" | "patients";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  /** مسار تنقّل؛ غيابه يعني إجراءً يفتح نافذة (حجز). */
  to?: string;
}

/**
 * الإجراءات السريعة حسب الصلاحيات الفعلية. «حجز موعد» لا يظهر إلا للطبيب الموثّق باشتراك فعّال
 * وبلا مساعد في المناوبة (canCreateAppointments من الخادم). غير ذلك يُخفى، والخادم يرفضه بـ403 مهما فعلت الواجهة.
 */
export function quickActions(input: {
  role: "DOCTOR" | "ASSISTANT" | string | undefined;
  verificationStatus: VerificationStatus | undefined;
  subscriptionActive: boolean | undefined;
  canCreateAppointments: boolean | undefined;
}): QuickAction[] {
  const actions: QuickAction[] = [];
  if (input.role === "DOCTOR" && input.canCreateAppointments === true && input.verificationStatus === "VERIFIED" && input.subscriptionActive === true) {
    actions.push({ id: "book", label: t("حجز موعد") });
  }
  actions.push({ id: "appointments", label: t("المواعيد"), to: "/appointments" });
  actions.push({ id: "queue", label: t("طابور اليوم"), to: "/appointments?tab=queue" });
  if (input.role === "DOCTOR") actions.push({ id: "patients", label: t("مرضاي"), to: "/patients" });
  return actions;
}

/** سطر توضيحي حين يغيب «حجز موعد» بسبب المساعد (وليس بسبب التوثيق أو الاشتراك). */
export function bookingHandledByAssistantNote(input: { hasActiveAssistant: boolean | undefined; canCreateAppointments: boolean | undefined }): string | null {
  return input.hasActiveAssistant === true && input.canCreateAppointments === false
    ? t("حجز المواعيد من مسؤولية مساعدك حاليًا.")
    : null;
}

/**
 * سطر «الأيام المتبقية» في لوحة الطبيب (العنصر الثاني بعد زر المداومة).
 * صادق: لا يُعرض عدد أيام إلا إن وُجد تاريخ انتهاء فعلي في السجل؛ null إن لم تتوفر البيانات بعد.
 */
export function subscriptionDaysLine(summary: SubscriptionSummary | null | undefined, now = Date.now()): { text: string; tone: BadgeTone } | null {
  if (!summary) return null;
  if (!summary.active) {
    return { text: summary.kind === "CLINIC" ? t("اشتراك العيادة منتهٍ") : t("اشتراكك منتهٍ — جدّده ليظهر ملفك للمرضى"), tone: "red" };
  }
  const left = daysUntil(summary.expiresAt, now);
  const soon = left !== null && left <= EXPIRY_WARNING_DAYS;
  const tone: BadgeTone = soon ? "amber" : summary.kind === "ACTIVE" ? "green" : "blue";
  if (left === null) {
    return { text: summary.kind === "TRIAL" ? t("فترة تجريبية مجانية") : summary.kind === "CLINIC" ? t("ضمن اشتراك العيادة") : t("اشتراك فعّال"), tone };
  }
  const days = left === 1 ? t("يوم واحد") : left === 2 ? t("يومان") : t("{0} {1}", { "0": left, "1": left >= 3 && left <= 10 ? t("أيام") : t("يومًا") });
  const text = summary.kind === "TRIAL"
    ? t("متبقٍ من الفترة التجريبية: {0}", { "0": days })
    : summary.kind === "CLINIC"
    ? t("متبقٍ من اشتراك العيادة: {0}", { "0": days })
    : t("متبقٍ من اشتراكك: {0}", { "0": days });
  return { text, tone };
}

/**
 * عدّاد الاشتراك في سطر المداومة: الرقم منفصل عن الوحدة ليُعرض كبيرًا.
 * days = null حين لا يوجد تاريخ انتهاء فعلي أو حين الاشتراك غير فعّال — لا نخترع رقمًا.
 */
export function subscriptionCountdown(summary: SubscriptionSummary | null | undefined, now = Date.now()): { days: number | null; unit: string; caption: string; tone: BadgeTone } | null {
  if (!summary) return null;
  if (!summary.active) {
    return { days: null, unit: "", caption: summary.kind === "CLINIC" ? t("اشتراك العيادة منتهٍ") : t("الاشتراك منتهٍ — جدّده"), tone: "red" };
  }
  const left = daysUntil(summary.expiresAt, now);
  const caption = summary.kind === "TRIAL" ? t("الفترة التجريبية") : summary.kind === "CLINIC" ? t("اشتراك العيادة") : t("اشتراكك");
  const tone: BadgeTone = left !== null && left <= EXPIRY_WARNING_DAYS ? "amber" : summary.kind === "ACTIVE" ? "green" : "blue";
  if (left === null) return { days: null, unit: "", caption: summary.kind === "TRIAL" ? t("فترة تجريبية مجانية") : t("اشتراك فعّال"), tone };
  const unit = left >= 3 && left <= 10 ? t("أيام متبقية") : left > 10 ? t("يومًا متبقيًا") : t("يوم متبقٍ");
  return { days: left, unit, caption, tone };
}
