import type { FamilyRelationship } from "@prisma/client";

/**
 * «المستفيد» من الموعد كما يُعرض للمريض وللطبيب — بلا أي حقل حساس (لا تاريخ ميلاد، لا جنس، لا معرّف حساب).
 *  - SELF: الموعد لصاحب الحساب نفسه (أو حجز ضيف قديم).
 *  - FAMILY_MEMBER: لأحد أفراد عائلة صاحب الحساب، مع الاسم وصلة القرابة فقط.
 *
 * دالة نقية (import type فقط) — تُختبر بلا قاعدة بيانات.
 */
export type BeneficiaryType = "SELF" | "FAMILY_MEMBER";

export interface Beneficiary {
  type: BeneficiaryType;
  name: string;
  relationship: FamilyRelationship | null;
  /** معرّف فرد العائلة (للفلترة في حساب المريض). null للموعد الذاتي. */
  familyMemberId: string | null;
}

export const RELATIONSHIP_LABELS_AR: Record<FamilyRelationship, string> = {
  CHILD: "ابن/ابنة",
  SPOUSE: "زوج/زوجة",
  PARENT: "أب/أم",
  SIBLING: "أخ/أخت",
  OTHER: "قريب",
};

export interface BeneficiarySource {
  familyMemberId?: string | null;
  familyMember?: { id: string; firstName: string; lastName: string; relationship: FamilyRelationship } | null;
  patient?: { firstName: string; lastName: string } | null;
  guestFirstName?: string | null;
  guestLastName?: string | null;
}

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ").trim();

export function beneficiaryOf(a: BeneficiarySource): Beneficiary {
  if (a.familyMemberId && a.familyMember) {
    return {
      type: "FAMILY_MEMBER",
      name: join(a.familyMember.firstName, a.familyMember.lastName),
      relationship: a.familyMember.relationship,
      familyMemberId: a.familyMember.id,
    };
  }
  // الحجز الذاتي: الاسم المكتوب عند الحجز (هو ما يراه الطبيب في الطابور)، وإلا اسم ملف المريض.
  const name = join(a.guestFirstName, a.guestLastName) || join(a.patient?.firstName, a.patient?.lastName);
  return { type: "SELF", name, relationship: null, familyMemberId: null };
}

/** حقول فرد العائلة الآمنة التي تُضمَّن في استعلامات المواعيد (Prisma select). */
export const FAMILY_MEMBER_PUBLIC_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  relationship: true,
} as const;
