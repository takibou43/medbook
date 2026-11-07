import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  before: {} as any, events: [] as string[], update: vi.fn(), notify: vi.fn(), push: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({
  prisma: { $transaction: async (work: any) => work({
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
import { updateDoctorAdmin } from "../src/modules/admin/admin.service";
describe("admin subscription transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks(); h.events = [];
    h.before = { verificationStatus: "VERIFIED", subscriptionStatus: "EXPIRED", subscriptionExpiresAt: new Date("2020-01-01"), clinic: null, user: { isActive: true } };
    h.update.mockImplementation(async ({ data }) => ({ ...h.before, ...data }));
    h.notify.mockResolvedValue([]);
  });
  it("locks before reading and persists a usable paid expiry", async () => {
    const result = await updateDoctorAdmin("doctor", { subscriptionStatus: "ACTIVE", subscriptionMonths: 3, expectedSubscriptionExpiresAt: h.before.subscriptionExpiresAt });
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
  it("keeps owned clinic billing on the clinic path", async () => {
    h.before.clinic = { ownerId: "owner" };
    await expect(updateDoctorAdmin("doctor", { subscriptionStatus: "ACTIVE", subscriptionMonths: 1, expectedSubscriptionExpiresAt: h.before.subscriptionExpiresAt })).rejects.toMatchObject({ statusCode: 400 });
    expect(h.update).not.toHaveBeenCalled();
  });
});
