import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ updateMany: vi.fn(), trial: { endsAt: "2099-12-31" } }));
vi.mock("../src/lib/prisma", () => ({ prisma: { doctor: { updateMany: h.updateMany } } }));
vi.mock("../src/config/env", () => ({ env: { trial: h.trial } }));
import { syncTrialSubscriptions } from "../src/lib/trial";
beforeEach(() => { vi.clearAllMocks(); h.updateMany.mockResolvedValue({ count: 0 }); });
describe("trial synchronization", () => {
  it("excludes new registrations from both legacy grants, including before approval", async () => {
    await syncTrialSubscriptions();
    expect(h.updateMany.mock.calls[0][0].where.newDoctorTrial).toBe(false);
    expect(h.updateMany.mock.calls[1][0].where.newDoctorTrial).toBe(false);
    expect(h.updateMany).toHaveBeenCalledTimes(3);
  });
  it("continues expiring trials from both account cohorts", async () => {
    await syncTrialSubscriptions();
    const expiry = h.updateMany.mock.calls[2][0];
    expect(expiry.where).toEqual({ subscriptionStatus: "ACTIVE", subscriptionExpiresAt: { lt: expect.any(Date) } });
    expect(expiry.data).toEqual({ subscriptionStatus: "EXPIRED" });
  });
});
