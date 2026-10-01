import { describe, expect, it } from "vitest";
import { SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { approvalTrialData } from "../src/lib/doctorApprovalTrial";

const now = new Date("2026-10-01T14:30:00Z");
const doctor = { newDoctorTrial: true, trialStartedAt: null, subscriptionStatus: SubscriptionStatus.UNPAID, subscriptionExpiresAt: null };
describe("new doctor trial starts at approval", () => {
  it("grants exactly 30 days from approval", () => {
    expect(approvalTrialData(doctor, VerificationStatus.VERIFIED, now)).toEqual({
      trialStartedAt: now, subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionExpiresAt: new Date("2026-10-31T14:30:00Z"),
    });
  });
  it.each([VerificationStatus.PENDING, VerificationStatus.REJECTED])("does not start on %s", status => {
    expect(approvalTrialData(doctor, status, now)).toEqual({});
  });
  it("leaves the existing experimental account unchanged", () => {
    expect(approvalTrialData({ ...doctor, newDoctorTrial: false }, VerificationStatus.VERIFIED, now)).toEqual({});
  });
  it("cannot renew a trial after expiration or rejection and reapproval", () => {
    expect(approvalTrialData({ ...doctor, trialStartedAt: now, subscriptionStatus: SubscriptionStatus.EXPIRED }, VerificationStatus.VERIFIED, new Date("2027-01-01"))).toEqual({});
  });
  it.each([SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED])("preserves an admin-assigned %s subscription", subscriptionStatus => {
    expect(approvalTrialData({ ...doctor, subscriptionStatus }, VerificationStatus.VERIFIED, now)).toEqual({ trialStartedAt: now });
  });
  it("preserves a previously assigned expiration", () => {
    expect(approvalTrialData({ ...doctor, subscriptionExpiresAt: new Date("2027-01-01") }, VerificationStatus.VERIFIED, now)).toEqual({ trialStartedAt: now });
  });
});
