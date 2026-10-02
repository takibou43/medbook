import { describe, it, expect } from "vitest";
import { isDoctorProfilePublic, hasEffectiveDoctorSubscription } from "../src/lib/doctorVisibility";

const now = new Date("2026-10-01T12:00:00Z");
const clinic = {
  ownerId: "owner", owner: { isActive: true }, verificationStatus: "VERIFIED",
  subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date("2026-11-01"), paidDoctorCount: 2,
};
const doctor = { verificationStatus: "VERIFIED", subscriptionStatus: "UNPAID", user: { isActive: true }, clinic };

describe("doctor announcement visibility follows effective billing", () => {
  it("announces a verified clinic doctor despite unpaid personal billing", () => {
    expect(isDoctorProfilePublic(doctor, now)).toBe(true);
  });
  it.each([
    { subscriptionStatus: "UNPAID" }, { verificationStatus: "PENDING" },
    { subscriptionExpiresAt: now }, { subscriptionExpiresAt: null },
    { paidDoctorCount: 0 }, { owner: { isActive: false } },
  ])("does not announce an unavailable clinic even with active personal billing: %j", patch => {
    expect(isDoctorProfilePublic({ ...doctor, subscriptionStatus: "ACTIVE", clinic: { ...clinic, ...patch } }, now)).toBe(false);
  });
  it("rejects inactive accounts and unverified doctors", () => {
    expect(isDoctorProfilePublic({ ...doctor, user: { isActive: false } }, now)).toBe(false);
    expect(isDoctorProfilePublic({ ...doctor, verificationStatus: "PENDING" }, now)).toBe(false);
  });
  it("keeps ownerless clinics on individual billing and rejects expired subscriptions", () => {
    expect(isDoctorProfilePublic({ ...doctor, subscriptionStatus: "ACTIVE", clinic: { ...clinic, ownerId: null } }, now)).toBe(true);
    expect(isDoctorProfilePublic({ ...doctor, subscriptionStatus: "ACTIVE", subscriptionExpiresAt: now, clinic: null }, now)).toBe(false);
  });
  it("requires verification for visibility but allows billing to be checked independently", () => {
    expect(hasEffectiveDoctorSubscription({ ...doctor, verificationStatus: "PENDING" }, now)).toBe(true);
  });
});
