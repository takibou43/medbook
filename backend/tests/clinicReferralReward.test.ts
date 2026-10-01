import { describe, it, expect } from "vitest";
import { addClinicReferralReward, activatePendingClinicRewards, clinicReferralBilling } from "../src/lib/clinicReferralReward";

const now = new Date("2026-10-01T12:00:00Z");
const day = 86_400_000;
const clinic = {
  verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", paidDoctorCount: 4,
  subscriptionExpiresAt: new Date(now.getTime() + 90 * day), referralDiscountUntil: null,
  pendingReferralDays: 0,
};

describe("clinic referral rewards", () => {
  it("bills four doctors as three for 30 days without changing paid capacity", () => {
    const reward = addClinicReferralReward(clinic, 30, now);
    expect(reward.referralDiscountUntil!.getTime()).toBe(now.getTime() + 30 * day);
    expect(clinicReferralBilling(4, reward.referralDiscountUntil!, now).monthlyTotal).toBe(12000);
    expect(clinic.paidDoctorCount).toBe(4);
  });
  it("expires at the exact end of the discount and never bills a negative amount", () => {
    expect(clinicReferralBilling(4, now, now).monthlyTotal).toBe(16000);
    expect(clinicReferralBilling(1, new Date(now.getTime() + day), now).monthlyTotal).toBe(0);
    expect(clinicReferralBilling(0, new Date(now.getTime() + day), now).monthlyTotal).toBe(0);
  });
  it("extends consecutive rewards without subtracting another doctor", () => {
    const first = addClinicReferralReward(clinic, 30, now);
    const second = addClinicReferralReward({ ...clinic, ...first }, 30, now);
    expect(second.referralDiscountUntil!.getTime()).toBe(now.getTime() + 60 * day);
    expect(clinicReferralBilling(4, second.referralDiscountUntil!, now).billedDoctorCount).toBe(3);
  });
  it.each([
    { subscriptionStatus: "UNPAID" }, { verificationStatus: "PENDING" },
    { subscriptionExpiresAt: now }, { paidDoctorCount: 0 },
  ])("banks the reward for unavailable clinics: %j", patch => {
    const state = { ...clinic, ...patch };
    const reward = addClinicReferralReward(state, 30, now);
    expect(reward.pendingReferralDays).toBe(30);
    expect(reward.referralDiscountUntil).toBe(undefined);
    expect(Object.keys(activatePendingClinicRewards({ ...state, ...reward }, now)).length).toBe(0);
  });
  it("consumes pending days once at activation without extending subscription expiry", () => {
    const state = { ...clinic, pendingReferralDays: 60 };
    const reward = activatePendingClinicRewards(state, now);
    expect(reward.pendingReferralDays).toBe(0);
    expect(reward.referralDiscountUntil!.getTime()).toBe(now.getTime() + 60 * day);
    expect(Object.keys(activatePendingClinicRewards({ ...state, ...reward }, now)).length).toBe(0);
    expect(state.subscriptionExpiresAt).toBe(clinic.subscriptionExpiresAt);
  });
});
