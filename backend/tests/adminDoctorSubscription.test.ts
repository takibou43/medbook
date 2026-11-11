import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  before: {} as any, events: [] as string[], update: vi.fn(), notify: vi.fn(), push: vi.fn(), audit: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({
  prisma: { $transaction: async (work: any) => work({
    auditLog: { create: h.audit, findFirst: async()=>null },
    doctor: {
      findUnique: async () => { h.events.push("read"); return h.before; },
      update: h.update,
    },
  }) },
}));
vi.mock("../src/modules/admin/adminSafety.service", () => ({ changeUserAccess: vi.fn(), saveCatalog: vi.fn(), removeCatalog: vi.fn() }));
vi.mock("../src/utils/password", () => ({ hashPassword: vi.fn() }));
vi.mock("../src/modules/notifications/notifications.service", () => ({ createNotification: vi.fn() }));
vi.mock("../src/lib/slots", () => ({ algeriaTodayUTCMidnight: vi.fn() }));
vi.mock("../src/config/env", () => ({ env: {} }));
vi.mock("../src/modules/reviews/reviews.service", () => ({ lockDoctorRow: async () => { h.events.push("lock"); }, recalcDoctorRating: vi.fn() }));
vi.mock("../src/modules/notifications/newDoctorArea.service", () => ({ queueNewDoctorAreaNotifications: h.notify, pushNewDoctorAreaNotification: h.push }));
vi.mock("../src/modules/referrals/referrals.service", () => ({ applyReferralOnVerificationTx: vi.fn(), notifyReferrerRewarded: vi.fn() }));
const receipt = { amountDzd: 15000, method: "CASH" as const, paidAt: "2026-01-01T00:00:00Z" };
import { updateDoctorAdmin } from "../src/modules/admin/admin.service";
describe("admin subscription transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks(); h.events = [];
    h.before = { updatedAt: new Date("2026-11-01"), newDoctorTrial: true, verificationStatus: "VERIFIED", subscriptionStatus: "EXPIRED", subscriptionExpiresAt: new Date("2020-01-01"), clinic: null, user: { isActive: true } };
    h.update.mockImplementation(async ({ data }) => ({ ...h.before, ...data }));
    h.notify.mockResolvedValue([]);
  });
  it("locks before reading and persists a usable paid expiry", async () => {
    const result = await updateDoctorAdmin("doctor", { subscriptionStatus: "ACTIVE", subscriptionAmountDzd: receipt.amountDzd, expectedSubscriptionExpiresAt: h.before.subscriptionExpiresAt }, "admin", h.before.updatedAt, "RENEW", receipt);
    expect(h.events).toEqual(["lock", "read"]);
    expect(result.subscriptionExpiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * 86400000);
    expect(result.newDoctorTrial).toBe(false);
    expect(h.notify).toHaveBeenCalledOnce();
    expect(h.update.mock.calls[0][0].data).not.toHaveProperty("subscriptionMonths");
    expect(h.update.mock.calls[0][0].data).not.toHaveProperty("expectedSubscriptionExpiresAt");
  });
  it("refuses stale renewal before writing", async () => {
    await expect(updateDoctorAdmin("doctor", { subscriptionStatus: "ACTIVE", subscriptionMonths: 1, expectedSubscriptionExpiresAt: null })).rejects.toMatchObject({ statusCode: 409 });
    expect(h.update).not.toHaveBeenCalled();
  });
  it("records the paid duration and actor in the same transaction", async () => {
    await updateDoctorAdmin("doctor", { subscriptionStatus: "ACTIVE", subscriptionAmountDzd: receipt.amountDzd, expectedSubscriptionExpiresAt: h.before.subscriptionExpiresAt }, "admin", h.before.updatedAt, "RENEW", receipt);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({userId:"admin",meta:expect.objectContaining({operation:"RENEW",receipt:expect.objectContaining({amountDzd:15000})})})}));
  });
  it("rejects a stale stop without a write", async () => {
    await expect(updateDoctorAdmin("doctor", {subscriptionStatus:"UNPAID"}, "admin", new Date("2026-10-01"), "STOP")).rejects.toMatchObject({statusCode:409});
    expect(h.update).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
  });
  it("resumes remaining trial without consuming trial or adding time", async () => {
    h.before.subscriptionStatus="UNPAID"; h.before.subscriptionExpiresAt=new Date("2099-01-01");
    const result=await updateDoctorAdmin("doctor",{subscriptionStatus:"ACTIVE"},"admin",h.before.updatedAt,"RESUME");
    expect(result.subscriptionExpiresAt).toEqual(h.before.subscriptionExpiresAt);
    expect(result.newDoctorTrial).toBe(true);
    expect(h.update.mock.calls[0][0].data).toMatchObject({subscriptionStatus:"ACTIVE",updatedAt:expect.any(Date)});
  });
  it("rejects resuming an expired subscription",async()=>{
    await expect(updateDoctorAdmin("doctor",{subscriptionStatus:"ACTIVE"},"admin",h.before.updatedAt,"RESUME")).rejects.toMatchObject({statusCode:400});
    expect(h.update).not.toHaveBeenCalled();
  });
  it("aborts when the ledger cannot be written",async()=>{
    h.audit.mockRejectedValueOnce(new Error("ledger failure"));
    await expect(updateDoctorAdmin("doctor",{subscriptionStatus:"ACTIVE",subscriptionAmountDzd:receipt.amountDzd,expectedSubscriptionExpiresAt:h.before.subscriptionExpiresAt},"admin",h.before.updatedAt,"RENEW",receipt)).rejects.toThrow("ledger failure");
    expect(h.push).not.toHaveBeenCalled();
  });
  it("keeps owned clinic billing on the clinic path", async () => {
    h.before.clinic = { ownerId: "owner" };
    await expect(updateDoctorAdmin("doctor", { subscriptionStatus: "ACTIVE", subscriptionMonths: 1, expectedSubscriptionExpiresAt: h.before.subscriptionExpiresAt })).rejects.toMatchObject({ statusCode: 400 });
    expect(h.update).not.toHaveBeenCalled();
  });
});


describe("subscription service rejects receipt bypasses", () => {
  it("rejects direct legacy extensions and status-only activation before writing", async () => {
    h.before = { updatedAt: new Date("2026-11-01"), subscriptionStatus: "EXPIRED", subscriptionExpiresAt: new Date("2020-01-01"), clinic: null };
    for (const data of [
      { subscriptionStatus: "ACTIVE" as const },
      { subscriptionStatus: "ACTIVE" as const, subscriptionExpiresAt: new Date("2099-01-01") },
      { subscriptionStatus: "ACTIVE" as const, subscriptionMonths: 1, expectedSubscriptionExpiresAt: h.before.subscriptionExpiresAt },
    ]) {
      vi.clearAllMocks();
      await expect(updateDoctorAdmin("doctor", data, "admin")).rejects.toMatchObject({ statusCode: 400 });
      expect(h.update).not.toHaveBeenCalled();
      expect(h.audit).not.toHaveBeenCalled();
    }
  });
});
