import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { doctor: { findUnique: vi.fn() }, appointment: { findUnique: vi.fn(), create: vi.fn() }, familyMember: { findFirst: vi.fn() } },
  reserve: vi.fn(), notify: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("../src/lib/clinicBilling", () => ({ isDoctorSubscriptionActive: vi.fn(async () => true) }));
vi.mock("../src/lib/clinicFinance", async importOriginal => ({ ...await importOriginal<object>(), loadFinancialCreate: vi.fn(async () => undefined) }));
vi.mock("../src/lib/slots", async importOriginal => ({ ...await importOriginal<object>(), isPast: vi.fn(() => false), generateAvailableSlots: vi.fn(() => ["09:00"]) }));
vi.mock("../src/lib/slotAssign", () => ({ reserveExactSlot: mocks.reserve, slotMinutesFor: () => 15, ExactSlotUnavailableError: class extends Error {} }));
vi.mock("../src/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("../src/modules/notifications/notifications.service", () => ({ createNotification: mocks.notify }));
import { createFollowUpAppointment, createGuestAppointment } from "../src/modules/treatment/followUpAppointment.service";
import { algeriaTodayUTCMidnight } from "../src/lib/slots";
const parent = () => ({ id: "parent", doctorId: "d", patientId: null, patient: null, familyMemberId: null, status: "COMPLETED", guestFirstName: "Ahmed", guestLastName: "Test", guestPhone: "0550000000" });
const input = () => ({ date: new Date(algeriaTodayUTCMidnight().getTime() + 86400000).toISOString().slice(0,10), startTime: "09:00", idempotencyKey: "request-1" });
describe("guest follow-up appointments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.doctor.findUnique.mockResolvedValue({ id: "d", verificationStatus: "VERIFIED", schedules: [], firstName: "Doctor", lastName: "Test" });
    mocks.db.appointment.findUnique.mockImplementation(async ({ where }) => where.id ? parent() : null);
    mocks.db.appointment.create.mockImplementation(async ({ data }) => ({ ...data, id: "follow-up", familyMember: null }));
    mocks.reserve.mockImplementation(async ({ create }) => ({ result: await create(mocks.db, { startTime: "09:00", endTime: "09:15" }) }));
  });
  it("copies the guest identity and links the original without creating an account", async () => {
    const result = await createFollowUpAppointment("doctor", "parent", input());
    expect(result.appointment).toMatchObject({ patientId: null, parentAppointmentId: "parent", status: "CONFIRMED" });
    expect(mocks.db.appointment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ guestFirstName: "Ahmed", guestLastName: "Test", guestPhone: "0550000000", familyMemberId: null }) }));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("books a named guest without an earlier appointment or account", async () => {
    await createGuestAppointment("doctor", { ...input(), firstName: "Ahmed", lastName: "Test", phone: "0550000000" });
    expect(mocks.db.appointment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ patientId: null, guestPhone: "0550000000", createdBy: "DOCTOR" }) }));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("rejects reuse of a booking key with a changed phone", async () => {
    const i = input();
    mocks.db.appointment.findUnique.mockResolvedValue({ patientId: null, parentAppointmentId: null, guestFirstName: "Ahmed", guestLastName: "Test", guestPhone: "0660000000", date: new Date(i.date), startTime: i.startTime });
    await expect(createGuestAppointment("doctor", { ...i, firstName: "Ahmed", lastName: "Test", phone: "0550000000" })).rejects.toThrow();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("rejects incomplete guest identity", async () => {
    mocks.db.appointment.findUnique.mockImplementation(async ({ where }) => where.id ? { ...parent(), guestPhone: null } : null);
    await expect(createFollowUpAppointment("doctor", "parent", input())).rejects.toThrow();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("cannot attach a guest to another family or treatment plan", async () => {
    for (const change of [{ familyMemberId: "other-family" }, { treatmentPlanId: "other-plan" }])
      await expect(createFollowUpAppointment("doctor", "parent", { ...input(), ...change })).rejects.toThrow();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("preserves a registered family beneficiary and its account notification", async () => {
    mocks.db.appointment.findUnique.mockImplementation(async ({ where }) => where.id ? { ...parent(), patientId: "p", familyMemberId: "child", patient: { id: "p", userId: "u", firstName: "Father", lastName: "Test", user: { phone: "0550000000" } } } : null);
    mocks.db.familyMember.findFirst.mockResolvedValue({ id: "child", firstName: "Child", lastName: "Test" });
    await createFollowUpAppointment("doctor", "parent", input());
    expect(mocks.db.appointment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ patientId: "p", familyMemberId: "child", guestFirstName: "Child" }) }));
    expect(mocks.notify).toHaveBeenCalledOnce();
  });
});
