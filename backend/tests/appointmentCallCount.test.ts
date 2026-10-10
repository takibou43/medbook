import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  doctor: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  assistant: { findFirst: vi.fn(), findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("../src/lib/actingDoctor", () => ({ resolveActingDoctorId: vi.fn(async () => "doctor") }));
vi.mock("../src/lib/doctorLock", () => ({ lockDoctorCalls: vi.fn(), DoctorQueueBusyError: class extends Error {} }));
import { callNextPatient, callSpecificPatient } from "../src/modules/appointments/appointments.service";

describe("successful call counter (mocked transaction)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async fn => fn(db));
    db.doctor.findUniqueOrThrow.mockResolvedValue({ dutyEndsAt: new Date(Date.now() + 60000), queueRequestedAt: new Date(), clinicId: null });
    db.assistant.findFirst.mockResolvedValue(null);
    db.assistant.findUnique.mockResolvedValue({ isActive: true, shiftEndsAt: new Date(Date.now() + 60000) });
    db.appointment.findFirst.mockResolvedValue(null);
    db.appointment.findMany.mockResolvedValue([{ id: "appointment", doctorId: "doctor", status: "CONFIRMED", startTime: "09:00", arrivedAt: new Date(), skipCredits: 0 }]);
    db.appointment.findUnique.mockResolvedValue({ id: "appointment", doctorId: "doctor", status: "LATE" });
    db.appointment.update.mockResolvedValue({ id: "appointment", callCount: 2 });
    db.appointment.updateMany.mockResolvedValue({ count: 0 });
  });
  it.each(["next", "specific"])("increments exactly once for %s calls", async mode => {
    if (mode === "next") await callNextPatient("user", Role.DOCTOR);
    else await callSpecificPatient("user", "appointment", Role.ASSISTANT);
    expect(db.appointment.update).toHaveBeenCalledTimes(1);
    expect(db.appointment.update.mock.calls[0][0].data).toMatchObject({ status: "IN_PROGRESS", callCount: { increment: 1 } });
  });
  it("rejects an occupied queue without incrementing or replacing its current call", async () => {
    db.appointment.findFirst.mockResolvedValue({ id: "current" });
    await expect(callNextPatient("user", Role.DOCTOR)).rejects.toThrow();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
});
