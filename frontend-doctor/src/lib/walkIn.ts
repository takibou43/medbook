import { t } from "../i18n/locale.ts";
/**
 * منطق نموذج «تسجيل مريض حضر» في شاشة الاستقبال — دوال نقية قابلة للاختبار.
 * الخادم (POST /appointments/walk-in) هو المرجع: هذه الفحوص لتوجيه المساعد مبكرًا فقط.
 */

export const ALGERIAN_PHONE_RE = /^0[5-7][0-9]{8}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** نفس تطبيع الخادم: نحذف المسافات والشرطات. */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export interface WalkInForm {
  firstName: string;
  lastName: string;
  phone: string;
  notes: string;
  /** "" = أقرب وقت متاح تلقائيًا؛ غير ذلك وقت محدد HH:mm من أوقات اليوم. */
  startTime: string;
}

export const EMPTY_WALK_IN: WalkInForm = { firstName: "", lastName: "", phone: "", notes: "", startTime: "" };

export type WalkInErrors = Partial<Record<keyof WalkInForm, string>>;

export function validateWalkIn(f: WalkInForm): WalkInErrors {
  const e: WalkInErrors = {};
  const first = f.firstName.trim();
  const last = f.lastName.trim();
  if (first.length < 2) e.firstName = t("الاسم قصير جدًا.");
  else if (first.length > 60) e.firstName = t("الاسم طويل جدًا.");
  if (last.length < 2) e.lastName = t("اللقب قصير جدًا.");
  else if (last.length > 60) e.lastName = t("اللقب طويل جدًا.");
  if (!ALGERIAN_PHONE_RE.test(normalizePhone(f.phone))) e.phone = t("رقم هاتف جزائري غير صالح (مثال: 0551234567).");
  if (f.startTime && !TIME_RE.test(f.startTime)) e.startTime = t("اختر وقتًا من القائمة.");
  if (f.notes.trim().length > 1000) e.notes = t("الملاحظات طويلة جدًا.");
  return e;
}

export interface WalkInBody {
  firstName: string;
  lastName: string;
  phone: string;
  notes?: string;
  startTime?: string;
  idempotencyKey: string;
}

/** جسم الطلب: لا حقول فارغة (الخادم strict)، والوقت يُرسل فقط إن اختير. */
export function buildWalkInBody(f: WalkInForm, idempotencyKey: string): WalkInBody {
  const body: WalkInBody = {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    phone: normalizePhone(f.phone),
    idempotencyKey,
  };
  const notes = f.notes.trim();
  if (notes) body.notes = notes;
  if (f.startTime) body.startTime = f.startTime;
  return body;
}

/**
 * مفتاح منع التكرار: يبقى نفسه طوال محاولة تسجيل واحدة (نقرة مزدوجة، إعادة بعد انقطاع الشبكة)،
 * ويُستبدل بعد نجاح التسجيل أو بعد رفض نهائي من الخادم (4xx) لأن الطلب لم يُنشئ شيئًا.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // احتياط لمتصفحات قديمة: UUID v4 من getRandomValues.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * هل نحتفظ بالمفتاح بعد فشل الطلب؟ نعم إن كانت النتيجة مجهولة (شبكة/مهلة/5xx): إعادة المحاولة
 * بنفس المفتاح تعيد نفس الموعد إن كان قد أُنشئ. لا لرفض صريح (4xx): لم يُنشأ شيء.
 */
export function keepKeyAfterError(status: number | undefined): boolean {
  return status === undefined || status >= 500;
}

/**
 * الطبيب الذي يُسجَّل له المريض، من الأطباء المرتبطين بالمساعد فقط:
 * طبيب واحد ⇒ يُختار تلقائيًا؛ الاختيار الحالي يبقى ما دام ضمن القائمة؛ غير ذلك ⇒ "" (يجب الاختيار).
 */
export function resolveWalkInDoctor(doctorIds: string[], current: string): string {
  if (doctorIds.length === 1) return doctorIds[0];
  return doctorIds.includes(current) ? current : "";
}
