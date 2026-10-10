import { t } from "../i18n/locale.ts";
import type { Appointment, Beneficiary, DoctorReferralStatus, FamilyRelationship } from "../types/index.ts";

/**
 * مساعدات نقية للميزات الجديدة في لوحة الطبيب (تُختبر بـnode --test). الخادم هو المرجع في كل الصلاحيات؛
 * هذه للعرض فقط (إظهار/إخفاء عناصر، نصوص عربية).
 */

export const RELATIONSHIP_LABELS: Record<FamilyRelationship, string> = {
  CHILD: "ابن/ابنة",
  SPOUSE: "زوج/زوجة",
  PARENT: "أب/أم",
  SIBLING: "أخ/أخت",
  OTHER: "قريب",
};

/** اسم المستفيد كما يظهر للطبيب: «ياسين بن علي (ابن/ابنة)» أو اسم صاحب الموعد. */
export function beneficiaryText(a: Pick<Appointment, "beneficiary" | "patient" | "guestFirstName" | "guestLastName">): string {
  const b: Beneficiary | undefined = a.beneficiary;
  if (b?.type === "FAMILY_MEMBER") return b.relationship ? `${b.name} (${t(RELATIONSHIP_LABELS[b.relationship])})` : b.name;
  const guest = [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ").trim();
  if (guest) return guest;
  return [a.patient?.firstName, a.patient?.lastName].filter(Boolean).join(" ").trim();
}

/** نفس قاعدة الخادم (lib/dentalSpecialty.ts) لإظهار رابط «خطط العلاج» — الخادم يرفض غير أطباء الأسنان على أي حال. */
export function isDentalSpecialty(s: { nameAr?: string | null; nameFr?: string | null } | null | undefined): boolean {
  if (!s) return false;
  const ar = (s.nameAr ?? "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا");
  if (/سنان/.test(ar)) return true;
  const fr = (s.nameFr ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /(dent|stomato|odonto|orthodont)/i.test(fr);
}

/** هل يمكن برمجة موعد عودة انطلاقًا من هذا الموعد؟ (مريض بحساب + غير ملغى). */
export function canScheduleFollowUp(a: Pick<Appointment, "patientId" | "status">): boolean {
  return Boolean(a.patientId) && a.status !== "CANCELLED";
}

export const REFERRAL_STATUS_LABELS: Record<DoctorReferralStatus, string> = {
  PENDING: "في انتظار التوثيق",
  QUALIFIED: "مؤهلة",
  REWARDED: "تمت إضافة 30 يومًا",
  REJECTED: "لم يُوثَّق بعد",
};

/** رابط التسجيل الذي يشاركه الطبيب مع زميله. */
export function referralLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/register?ref=${encodeURIComponent(code)}`;
}

/** كود الإحالة من رابط التسجيل (?ref=) — تطبيع خفيف فقط؛ الخادم يتحقق. */
export function referralCodeFromSearch(search: string): string {
  const raw = new URLSearchParams(search).get("ref") ?? "";
  return raw.trim().toUpperCase().slice(0, 20);
}

/** "YYYY-MM-DD" لتاريخ اليوم بتوقيت الجزائر (UTC+1) مع إزاحة أيام. */
export function algeriaDay(offsetDays = 0, now = Date.now()): string {
  return new Date(now + 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** تاريخ «بعد N أشهر» بتقويم الجزائر مع قصّ آخر الشهر (مثل الخادم). */
export function addMonthsDay(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}
