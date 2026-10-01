import { Prisma, SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { hasEffectiveDoctorSubscription } from "./doctorVisibility";

export const INDEPENDENT_DOCTOR_MONTHLY_DZD = 5000;
import { CLINIC_DOCTOR_MONTHLY_DZD } from "./clinicReferralReward";
export { CLINIC_DOCTOR_MONTHLY_DZD } from "./clinicReferralReward";
export function clinicMonthlyTotal(count: number) {
  return count * CLINIC_DOCTOR_MONTHLY_DZD;
}
export function activeClinicWhere(now = new Date()): Prisma.ClinicWhereInput {
  return {
    ownerId: { not: null }, owner: { isActive: true },
    verificationStatus: VerificationStatus.VERIFIED,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    subscriptionExpiresAt: { gt: now }, paidDoctorCount: { gt: 0 },
  };
}
// Legacy clinics without an owner retain their independent-doctor billing.
export function doctorSubscriptionWhere(now = new Date()): Prisma.DoctorWhereInput {
  return { OR: [
    { AND: [
      { OR: [{ clinicId: null }, { clinic: { ownerId: null } }] },
      { subscriptionStatus: SubscriptionStatus.ACTIVE },
      { OR: [{ subscriptionExpiresAt: null }, { subscriptionExpiresAt: { gt: now } }] },
    ] },
    { clinic: activeClinicWhere(now) },
  ] };
}
export async function isDoctorSubscriptionActive(doctor: {
  clinicId?: string | null; subscriptionStatus: SubscriptionStatus; subscriptionExpiresAt?: Date | null; user?: { isActive: boolean };
}, now = new Date()) {
  if (doctor.user?.isActive === false) return false;
  const clinic = doctor.clinicId
    ? await prisma.clinic.findUnique({ where: { id: doctor.clinicId }, include: { owner: { select: { isActive: true } } } })
    : null;
  return hasEffectiveDoctorSubscription({ ...doctor, clinic }, now);
}
