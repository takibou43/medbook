import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { isDoctorSubscriptionActive } from "./clinicBilling";
import { trialEndsAt } from "./trial";

/**
 * ملخص اشتراك الطبيب لرأس لوحة التحكم — يُحسب من نفس مصدر الحقيقة المعتمد (isDoctorSubscriptionActive) ولا يخترع
 * مدة أو تاريخ انتهاء: expiresAt يأتي من سجل الطبيب أو عيادته فقط، وإلا null.
 *
 * kind:
 *  - CLINIC  : اشتراكه مشمول في اشتراك عيادة لها مالك (الفوترة على العيادة؛ لا زر دفع للطبيب).
 *  - TRIAL   : فترة تجربة مجانية سارية (تجربة الطبيب الجديد أو تجربة المنصة العامة).
 *  - ACTIVE  : اشتراك مدفوع/مفعّل وساري.
 *  - EXPIRED : كان له اشتراك وانتهى أو أُوقف.
 *  - NONE    : لا اشتراك أصلًا (لم يُمنح).
 */
export type SubscriptionKind = "CLINIC" | "TRIAL" | "ACTIVE" | "EXPIRED" | "NONE";

export interface SubscriptionSummary {
  kind: SubscriptionKind;
  active: boolean;
  clinicName: string | null;
  expiresAt: string | null;
}

export function summarizeSubscription(input: {
  active: boolean;
  clinic: { nameAr: string; ownerId: string | null; subscriptionExpiresAt: Date | null } | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: Date | null;
  newDoctorTrial: boolean;
  platformTrialEnd: Date | null;
}): SubscriptionSummary {
  const { active, clinic } = input;
  if (clinic?.ownerId) {
    return { kind: "CLINIC", active, clinicName: clinic.nameAr, expiresAt: clinic.subscriptionExpiresAt?.toISOString() ?? null };
  }
  const expiresAt = input.subscriptionExpiresAt?.toISOString() ?? null;
  if (!active) {
    const neverGranted = input.subscriptionStatus === SubscriptionStatus.UNPAID && !input.subscriptionExpiresAt;
    return { kind: neverGranted ? "NONE" : "EXPIRED", active: false, clinicName: null, expiresAt };
  }
  const isTrial =
    input.newDoctorTrial ||
    Boolean(input.platformTrialEnd && input.subscriptionExpiresAt && input.subscriptionExpiresAt.getTime() === input.platformTrialEnd.getTime());
  return { kind: isTrial ? "TRIAL" : "ACTIVE", active: true, clinicName: null, expiresAt };
}

export async function loadSubscriptionSummary(doctor: {
  clinicId: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: Date | null;
  newDoctorTrial: boolean;
  user?: { isActive: boolean };
}): Promise<SubscriptionSummary> {
  const [active, clinic] = await Promise.all([
    isDoctorSubscriptionActive(doctor),
    doctor.clinicId
      ? prisma.clinic.findUnique({ where: { id: doctor.clinicId }, select: { nameAr: true, ownerId: true, subscriptionExpiresAt: true } })
      : Promise.resolve(null),
  ]);
  return summarizeSubscription({
    active,
    clinic,
    subscriptionStatus: doctor.subscriptionStatus,
    subscriptionExpiresAt: doctor.subscriptionExpiresAt,
    newDoctorTrial: doctor.newDoctorTrial,
    platformTrialEnd: trialEndsAt(),
  });
}
