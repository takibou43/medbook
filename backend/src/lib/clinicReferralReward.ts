const DAY_MS = 86_400_000;
export const CLINIC_DOCTOR_MONTHLY_DZD = 4000;

export type ClinicRewardState = {
  verificationStatus: string;
  subscriptionStatus: string;
  subscriptionExpiresAt: Date | null;
  paidDoctorCount: number;
  referralDiscountUntil: Date | null;
  pendingReferralDays: number;
};

export function canUseClinicReward(clinic: ClinicRewardState, now: Date) {
  return clinic.verificationStatus === "VERIFIED" && clinic.subscriptionStatus === "ACTIVE" &&
    !!clinic.subscriptionExpiresAt && clinic.subscriptionExpiresAt > now && clinic.paidDoctorCount > 0;
}

// Each referral pays for one doctor for 30 days. Further referrals extend this
// window; they never reduce the clinic's capacity or change access permissions.
export function addClinicReferralReward(clinic: ClinicRewardState, days: number, now = new Date()) {
  if (!Number.isInteger(days) || days <= 0) throw new Error("Invalid referral reward days");
  if (!canUseClinicReward(clinic, now)) {
    return { pendingReferralDays: clinic.pendingReferralDays + days };
  }
  const base = Math.max(now.getTime(), clinic.referralDiscountUntil?.getTime() ?? 0);
  return {
    pendingReferralDays: 0,
    referralDiscountUntil: new Date(base + (days + clinic.pendingReferralDays) * DAY_MS),
  };
}

export function activatePendingClinicRewards(clinic: ClinicRewardState, now = new Date()) {
  if (clinic.pendingReferralDays === 0 || !canUseClinicReward(clinic, now)) return {};
  const base = Math.max(now.getTime(), clinic.referralDiscountUntil?.getTime() ?? 0);
  return { pendingReferralDays: 0, referralDiscountUntil: new Date(base + clinic.pendingReferralDays * DAY_MS) };
}

export function clinicReferralBilling(doctorCount: number, discountUntil: Date | null, now = new Date()) {
  if (!Number.isInteger(doctorCount) || doctorCount < 0) throw new Error("Invalid doctor count");
  const discountedDoctorCount = doctorCount > 0 && discountUntil && discountUntil > now ? 1 : 0;
  const billedDoctorCount = doctorCount - discountedDoctorCount;
  return { doctorCount, discountedDoctorCount, billedDoctorCount, monthlyTotal: billedDoctorCount * CLINIC_DOCTOR_MONTHLY_DZD };
}
