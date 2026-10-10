import { t } from "../i18n/locale.ts";
import type { Beneficiary, FamilyMember, FamilyRelationship, MyAppointment } from "../types/index.ts";

/**
 * مساعدات الحساب العائلي (دوال نقية تُختبر بـnode --test). لا تخزين: أفراد العائلة يُجلبون من الخادم
 * عند الحاجة ويبقون في ذاكرة React Query فقط — لا تخزين محلي في المتصفح ولا Service Worker.
 */

export const RELATIONSHIP_LABELS: Record<FamilyRelationship, string> = {
  CHILD: "ابن/ابنة",
  SPOUSE: "زوج/زوجة",
  PARENT: "أب/أم",
  SIBLING: "أخ/أخت",
  OTHER: "قريب",
};

export const RELATIONSHIP_OPTIONS = (Object.keys(RELATIONSHIP_LABELS) as FamilyRelationship[]).map((value) => ({
  value,
  label: RELATIONSHIP_LABELS[value],
}));

export function memberFullName(m: Pick<FamilyMember, "firstName" | "lastName">): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
}

/** «ياسين بن علي (ابن/ابنة)» — ما يُعرض قبل تأكيد الحجز وفي بطاقة الموعد. */
export function beneficiaryLabel(b: Beneficiary | null | undefined): string {
  if (!b || b.type === "SELF") return t("أنا (صاحب الحساب)");
  return b.relationship ? `${b.name} (${t(RELATIONSHIP_LABELS[b.relationship])})` : b.name;
}

export function isFamilyAppointment(a: Pick<MyAppointment, "beneficiary" | "familyMemberId">): boolean {
  return a.beneficiary?.type === "FAMILY_MEMBER" || Boolean(a.familyMemberId);
}

/** فلتر قائمة المواعيد: "all" = كل الأسرة، "self" = أنا، أو معرّف فرد. */
export type BeneficiaryFilter = "all" | "self" | string;

export function filterByBeneficiary<T extends Pick<MyAppointment, "beneficiary" | "familyMemberId">>(list: T[], filter: BeneficiaryFilter): T[] {
  if (filter === "all") return list;
  if (filter === "self") return list.filter((a) => !isFamilyAppointment(a));
  return list.filter((a) => (a.beneficiary?.familyMemberId ?? a.familyMemberId) === filter);
}

/** أفراد يمكن الحجز لهم (غير مؤرشفين). */
export function bookableMembers(list: FamilyMember[] | undefined): FamilyMember[] {
  return (list ?? []).filter((m) => !m.archivedAt);
}

/** تحقق سريع في الواجهة (الخادم يعيد التحقق كاملًا). */
export function validateMemberForm(v: { firstName: string; lastName: string; relationship: string; birthDate?: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  const fn = v.firstName.trim();
  const ln = v.lastName.trim();
  if (fn.length < 2) errors.firstName = t("الاسم قصير جدًا");
  else if (fn.length > 60) errors.firstName = t("الاسم طويل جدًا");
  if (ln.length < 2) errors.lastName = t("اللقب قصير جدًا");
  else if (ln.length > 60) errors.lastName = t("اللقب طويل جدًا");
  if (!(v.relationship in RELATIONSHIP_LABELS)) errors.relationship = t("اختر صلة القرابة");
  if (v.birthDate) {
    const d = new Date(v.birthDate + "T00:00:00Z");
    if (isNaN(d.getTime()) || d.getTime() > Date.now()) errors.birthDate = t("تاريخ الميلاد غير منطقي");
  }
  return errors;
}
