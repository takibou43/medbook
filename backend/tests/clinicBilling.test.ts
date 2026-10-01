import { describe, it, expect, vi, beforeEach } from "vitest";
const h = vi.hoisted(() => ({ findClinic: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ prisma: { clinic: { findUnique: h.findClinic } } }));
import { clinicMonthlyTotal, isDoctorSubscriptionActive } from "../src/lib/clinicBilling";
import { registerClinicSchema, clinicProfileSchema, acceptClinicInviteSchema } from "../src/modules/clinics/clinics.schema";
const now = new Date("2026-10-01T12:00:00Z");
const doctor = { clinicId: "clinic", subscriptionStatus: "UNPAID" as const, subscriptionExpiresAt: null };
const active = { ownerId: "owner", owner: { isActive: true }, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date("2026-11-01"), paidDoctorCount: 4 };
describe("Clinic billing", () => {
  beforeEach(() => vi.resetAllMocks());
  it("prices the owner's practising profile once alongside other doctors", () => expect(clinicMonthlyTotal(4)).toBe(16000));
  it("allows clinic doctors despite their independent subscription being unpaid", async () => {
    h.findClinic.mockResolvedValue(active); expect(await isDoctorSubscriptionActive(doctor, now)).toBe(true);
  });
  it.each([
    { subscriptionStatus: "UNPAID" }, { verificationStatus: "PENDING" },
    { subscriptionExpiresAt: new Date("2026-09-30") }, { subscriptionExpiresAt: null },
    { paidDoctorCount: 0 }, { owner: { isActive: false } },
  ])("denies an unavailable clinic even when the personal subscription is active (%j)", async patch => {
    h.findClinic.mockResolvedValue({ ...active, ...patch });
    expect(await isDoctorSubscriptionActive({ ...doctor, subscriptionStatus: "ACTIVE" }, now)).toBe(false);
  });
  it("preserves legacy clinic subscriptions", async () => {
    h.findClinic.mockResolvedValue({ ownerId: null });
    expect(await isDoctorSubscriptionActive({ ...doctor, subscriptionStatus: "ACTIVE" }, now)).toBe(true);
  });
  it("denies expired independent subscriptions without waiting for a scheduler", async () => {
    expect(await isDoctorSubscriptionActive({ clinicId: null, subscriptionStatus: "ACTIVE", subscriptionExpiresAt: now }, now)).toBe(false);
  });
});
describe("Clinic registration boundaries", () => {
  const clinic = { nameAr: "عيادة الاختبار", address: "شارع الاختبار", cityId: "11111111-1111-4111-8111-111111111111", wilayaId: "22222222-2222-4222-8222-222222222222" };
  it("rejects assigning ownership or paid status through registration", () => {
    expect(registerClinicSchema.safeParse({ email: "test@example.com", password: "strong-test-password", clinic: { ...clinic, subscriptionStatus: "ACTIVE" } }).success).toBe(false);
    expect(clinicProfileSchema.safeParse({ ...clinic, ownerId: "attacker" }).success).toBe(false);
  });
  it("does not let an invited doctor choose another clinic or a privileged role", () => {
    expect(acceptClinicInviteSchema.safeParse({ token: "a".repeat(64), password: "strong-test-password", doctor: { firstName: "أمين", lastName: "الاختبار", specialtyId: clinic.cityId, clinicId: clinic.cityId } }).success).toBe(false);
  });
});
