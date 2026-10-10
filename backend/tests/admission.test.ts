import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
const db = vi.hoisted(() => ({
  doctor: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  assistant: { findFirst: vi.fn(), findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/lib/actingDoctor", () => ({ resolveActingDoctorId: vi.fn(async () => "doctor-1") }));
vi.mock("../src/lib/doctorLock", () => ({ lockDoctorCalls: vi.fn(), DoctorQueueBusyError: class extends Error {} }));
vi.mock("../src/lib/audit", () => ({ writeAudit: vi.fn() }));
import { callNextPatient, callSpecificPatient, markPatientArrived } from "../src/modules/appointments/appointments.service";
import { algeriaTodayUTCMidnight } from "../src/lib/slots";

describe("admission handshake (mocked transaction)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async fn => fn(db));
    db.doctor.findUniqueOrThrow.mockResolvedValue({ dutyEndsAt: new Date(Date.now() + 60000), queueRequestedAt: new Date(), clinicId: null });
    db.assistant.findFirst.mockResolvedValue({ id: "assistant-1" });
    db.assistant.findUnique.mockResolvedValue({ isActive: true, shiftEndsAt: new Date(Date.now() + 60000) });
    db.appointment.findFirst.mockResolvedValue(null);
  });
  it("doctor's request returns no patient identity and does not admit anyone", async () => {
    expect(await callNextPatient("doctor-user", Role.DOCTOR)).toEqual({ awaitingAssistant: true });
    expect(db.appointment.update).not.toHaveBeenCalled();
    expect(db.appointment.findMany).not.toHaveBeenCalled();
  });
  it("rejects requests after automatic end of doctor's duty", async () => {
    db.doctor.findUniqueOrThrow.mockResolvedValue({ dutyEndsAt: new Date(Date.now() - 1000) });
    await expect(callNextPatient("doctor-user", Role.DOCTOR)).rejects.toThrow();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it("doctor fallback also requires actual arrival", async () => {
    db.assistant.findFirst.mockResolvedValue(null);
    db.appointment.findMany.mockResolvedValue([{ id: "absent", startTime: "09:00", status: "CONFIRMED", arrivedAt: null }]);
    await expect(callNextPatient("doctor-user", Role.DOCTOR)).rejects.toThrow();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it("rechecks priority when the earlier patient arrives before confirmation", async () => {
    db.appointment.findMany.mockResolvedValue([
      { id: "mohamed", startTime: "10:00", arrivedAt: new Date(), status: "CONFIRMED" },
      { id: "ahmed", startTime: "09:00", arrivedAt: new Date(), status: "LATE" },
    ]);
    await expect(callSpecificPatient("assistant-user", "mohamed", Role.ASSISTANT)).rejects.toThrow();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it("never replaces an admitted patient", async () => {
    db.appointment.findFirst.mockResolvedValue({ id: "inside" });
    await expect(callSpecificPatient("assistant-user", "ahmed", Role.ASSISTANT)).rejects.toThrow();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it("requires a doctor request before assistant confirmation", async () => {
    db.doctor.findUniqueOrThrow.mockResolvedValue({ dutyEndsAt: new Date(Date.now() + 60000), queueRequestedAt: null });
    await expect(callSpecificPatient("assistant-user", "ahmed", Role.ASSISTANT)).rejects.toThrow();
  });
  it("allows a guest early, preserving appointment identity", async () => {
    const guest = { id: "guest", startTime: "23:00", arrivedAt: new Date(), status: "CONFIRMED", patientId: null, familyMemberId: null };
    db.appointment.findMany.mockResolvedValue([guest]);
    db.appointment.update.mockResolvedValue({ ...guest, status: "IN_PROGRESS" });
    expect(await callSpecificPatient("assistant-user", "guest", Role.ASSISTANT)).toMatchObject({ id: "guest", patientId: null, status: "IN_PROGRESS" });
    expect(db.doctor.update).toHaveBeenCalledWith({ where: { id: "doctor-1" }, data: { queueRequestedAt: null } });
  });
  it("repeated arrival preserves its first timestamp", async () => {
    const arrivedAt = new Date(Date.now() - 60000);
    db.appointment.findUnique.mockResolvedValue({ id: "a", doctorId: "doctor-1", date: algeriaTodayUTCMidnight(), status: "CONFIRMED", arrivedAt });
    await markPatientArrived("assistant-user", "a", Role.ASSISTANT);
    expect(db.appointment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { arrivedAt, skipCredits: 0 } }));
  });
});
