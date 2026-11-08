import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/prisma", () => ({ prisma: {} }));
vi.mock("../src/lib/clinicBilling", () => ({ isDoctorSubscriptionActive: vi.fn() }));
vi.mock("../src/lib/trial", () => ({ trialEndsAt: vi.fn() }));
import { SubscriptionStatus as S } from "@prisma/client";
import { summarizeSubscription } from "../src/lib/doctorSubscriptionSummary";
import { paidSubscriptionData } from "../src/lib/doctorPaidSubscription";
describe("paid versus free subscription display", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const doctor = { subscriptionStatus: S.ACTIVE, subscriptionExpiresAt: new Date("2026-11-20T12:00:00Z"), newDoctorTrial: true };
  const context = { active: true, clinic: null, platformTrialEnd: null };
  it("shows the first free month as trial", () => {
    expect(summarizeSubscription({ ...context, ...doctor }).kind).toBe("TRIAL");
  });
  it("shows a paid extension as active instead of free trial", () => {
    const data = paidSubscriptionData(doctor, { subscriptionStatus: S.ACTIVE, subscriptionMonths: 3, expectedSubscriptionExpiresAt: doctor.subscriptionExpiresAt }, now);
    const summary = summarizeSubscription({ ...context, ...doctor, ...data });
    expect(summary.kind).toBe("ACTIVE");
    expect(summary.expiresAt).toBe("2027-02-20T12:00:00.000Z");
  });
});
