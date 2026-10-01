import { Prisma, SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { prisma } from "./prisma";

export const INDEPENDENT_DOCTOR_MONTHLY_DZD = 5000;
export const CLINIC_DOCTOR_MONTHLY_DZD = 4000;
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
  if (doctor.clinicId) {
    const clinic = await prisma.clinic.findUnique({ where: { id: doctor.clinicId }, include: { owner: { select: { isActive: true } } } });
    if (clinic?.ownerId) return clinic.owner?.isActive === true && clinic.verificationStatus === VerificationStatus.VERIFIED &&
      clinic.subscriptionStatus === SubscriptionStatus.ACTIVE && clinic.paidDoctorCount > 0 &&
      !!clinic.subscriptionExpiresAt && clinic.subscriptionExpiresAt > now;
  }
  return doctor.subscriptionStatus === SubscriptionStatus.ACTIVE &&
    (!doctor.subscriptionExpiresAt || doctor.subscriptionExpiresAt > now);
}
