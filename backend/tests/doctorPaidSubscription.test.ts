import { describe, expect, it } from "vitest";
import { SubscriptionStatus as S, VerificationStatus } from "@prisma/client";
import { paidSubscriptionData } from "../src/lib/doctorPaidSubscription";
import { approvalTrialData } from "../src/lib/doctorApprovalTrial";
import { hasEffectiveDoctorSubscription } from "../src/lib/doctorVisibility";
const now = new Date("2026-11-07T12:00:00Z");
const before = { subscriptionStatus: S.EXPIRED, subscriptionExpiresAt: new Date("2026-11-01T12:00:00Z") };
const renew = (months = 1) => ({ subscriptionStatus: S.ACTIVE, subscriptionMonths: months, expectedSubscriptionExpiresAt: before.subscriptionExpiresAt });
describe("manual paid doctor subscriptions", () => {
  it.each([[1,"2026-12-07"],[2,"2027-01-07"],[3,"2027-02-07"],[6,"2027-05-07"],[12,"2027-11-07"]] as const)("activates %i calendar months from today after expiration", (months, end) => {
    const result = paidSubscriptionData(before, renew(months), now);
    expect(result.subscriptionExpiresAt).toEqual(new Date(end+"T12:00:00Z"));
    expect(result.newDoctorTrial).toBe(false);
    expect(hasEffectiveDoctorSubscription({ ...before, ...result }, now)).toBe(true);
  });
  it("extends early from the existing end and preserves remaining trial time", () => {
    const future = new Date("2026-11-20T12:00:00Z");
    const result = paidSubscriptionData({ subscriptionStatus: S.ACTIVE, subscriptionExpiresAt: future }, { ...renew(3), expectedSubscriptionExpiresAt: future }, now);
    expect(result.subscriptionExpiresAt).toEqual(new Date("2027-02-20T12:00:00Z"));
  });
  it("starts from today at the exact expiration boundary", () => {
    expect(paidSubscriptionData({ ...before, subscriptionExpiresAt: now }, { ...renew(), expectedSubscriptionExpiresAt: now }, now).subscriptionExpiresAt)
      .toEqual(new Date("2026-12-07T12:00:00Z"));
  });
  it("handles first payment with no expiry and consumes free eligibility", () => {
    const result = paidSubscriptionData({ subscriptionStatus: S.UNPAID, subscriptionExpiresAt: null }, { ...renew(2), expectedSubscriptionExpiresAt: null }, now);
    expect(result.subscriptionExpiresAt).toEqual(new Date("2027-01-07T12:00:00Z"));
    expect(approvalTrialData({ ...before, ...result, trialStartedAt: null }, VerificationStatus.VERIFIED, now)).toEqual({});
  });
  it("rejects duplicate/stale renewals instead of granting months twice", () => {
    const result = paidSubscriptionData(before, renew(), now);
    expect(() => paidSubscriptionData({ ...before, ...result }, renew(), now)).toThrow(expect.objectContaining({ statusCode: 409 }));
  });
  it.each([0, -1, 1.5, 121, NaN, Infinity])("rejects invalid duration %s", months => {
    expect(() => paidSubscriptionData(before, renew(months), now)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
  it("requires a snapshot and active status for a renewal", () => {
    expect(() => paidSubscriptionData(before, { subscriptionStatus: S.ACTIVE, subscriptionMonths: 1 }, now)).toThrow();
    expect(() => paidSubscriptionData(before, { ...renew(), subscriptionStatus: S.UNPAID }, now)).toThrow();
    expect(() => paidSubscriptionData(before, { ...renew(), subscriptionExpiresAt: new Date("2027-01-01") }, now)).toThrow();
  });
  it("supports older activation requests without retaining an expired date", () => {
    expect(paidSubscriptionData(before, { subscriptionStatus: S.ACTIVE }, now).subscriptionExpiresAt).toEqual(new Date("2026-12-07T12:00:00Z"));
  });
  it("keeps stopping separate from payment and retains trial history", () => {
    expect(paidSubscriptionData(before, { subscriptionStatus: S.UNPAID }, now)).toEqual({ subscriptionStatus: S.UNPAID });
  });
  it.each([null, now, new Date("2026-01-01")])("refuses activating with an explicit invalid expiry %s", subscriptionExpiresAt => {
    expect(() => paidSubscriptionData(before, { subscriptionStatus: S.ACTIVE, subscriptionExpiresAt }, now)).toThrow();
  });
});
