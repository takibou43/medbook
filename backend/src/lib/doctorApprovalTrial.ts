import { SubscriptionStatus, VerificationStatus } from "@prisma/client";

type TrialDoctor = {
  newDoctorTrial: boolean;
  trialStartedAt: Date | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: Date | null;
};

/** Called under the doctor's row lock: a first approval consumes eligibility once. */
export function approvalTrialData(doctor: TrialDoctor, status: VerificationStatus, now = new Date()) {
  if (status !== VerificationStatus.VERIFIED || !doctor.newDoctorTrial || doctor.trialStartedAt) return {};
  // Keep subscriptions already assigned by the administrator intact.
  if (doctor.subscriptionStatus !== SubscriptionStatus.UNPAID || doctor.subscriptionExpiresAt) {
    return { trialStartedAt: now };
  }
  return {
    trialStartedAt: now,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    subscriptionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
}
