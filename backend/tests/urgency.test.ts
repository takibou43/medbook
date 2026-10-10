import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
const db = vi.hoisted(() => ({ appointment: { findUnique: vi.fn(), update: vi.fn() }, doctor: { findUniqueOrThrow: vi.fn() }, $transaction: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/lib/actingDoctor", () => ({ resolveActingDoctorId: vi.fn(async () => "d") }));
vi.mock("../src/lib/doctorLock", () => ({ lockDoctorCalls: vi.fn() }));
vi.mock("../src/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("../src/modules/shifts/shifts.service", () => ({ assertReception: vi.fn() }));
import { requestUrgency, decideUrgency } from "../src/modules/appointments/urgency.service";
import { firstPresent, presentQueueOrder } from "../src/lib/presentQueue";
import { algeriaTodayUTCMidnight } from "../src/lib/slots";
const patient = () => ({ id: "a", doctorId: "d", date: algeriaTodayUTCMidnight(), arrivedAt: new Date(), status: "CONFIRMED", urgencyStatus: "NONE" });
describe("urgent admission requests", () => {
  beforeEach(() => { vi.clearAllMocks(); db.$transaction.mockImplementation(fn => fn(db)); db.appointment.findUnique.mockResolvedValue(patient()); db.doctor.findUniqueOrThrow.mockResolvedValue({ dutyEndsAt: new Date(Date.now() + 60000) }); });
  it("records a request without admitting the patient", async () => {
    await requestUrgency("assistant", Role.ASSISTANT, "a", "Needs assessment");
    expect(db.appointment.update).toHaveBeenCalledWith({ where: { id: "a" }, data: expect.objectContaining({ urgencyStatus: "REQUESTED", urgencyReason: "Needs assessment" }) });
    expect(db.appointment.update.mock.calls[0][0].data.status).toBeUndefined();
  });
  it("rejects absent patients and appointments belonging to another doctor", async () => {
    for (const override of [{ arrivedAt: null }, { doctorId: "other" }, { status: "IN_PROGRESS" }]) {
      db.appointment.findUnique.mockResolvedValue({ ...patient(), ...override });
      await expect(requestUrgency("assistant", Role.ASSISTANT, "a", "Reason")).rejects.toThrow();
    }
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it("requires a brief reason and refuses repeated requests", async () => {
    await expect(requestUrgency("a", Role.ASSISTANT, "a", " ")).rejects.toThrow();
    db.appointment.findUnique.mockResolvedValue({ ...patient(), urgencyStatus: "APPROVED" });
    await expect(requestUrgency("a", Role.ASSISTANT, "a", "Reason")).rejects.toThrow();
  });
  it("only the doctor can approve", async () => {
    await expect(decideUrgency("assistant", Role.ASSISTANT, "a", true)).rejects.toThrow();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it.each([true, false])("records doctor's decision %s without interrupting a consultation", async approve => {
    db.appointment.findUnique.mockResolvedValue({ ...patient(), urgencyStatus: "REQUESTED" });
    await decideUrgency("doctor", Role.DOCTOR, "a", approve);
    expect(db.appointment.update).toHaveBeenCalledWith({ where: { id: "a" }, data: expect.objectContaining({ urgencyStatus: approve ? "APPROVED" : "DECLINED", urgencyDecidedBy: "doctor" }) });
    expect(db.appointment.update.mock.calls[0][0].data.status).toBeUndefined();
  });
  it("does not accept a stale decision", async () => {
    db.appointment.findUnique.mockResolvedValue({ ...patient(), urgencyStatus: "DECLINED" });
    await expect(decideUrgency("doctor", Role.DOCTOR, "a", true)).rejects.toThrow();
  });
  it("gives priority only to approved, present, waiting patients", () => {
    const normal = { id: "normal", startTime: "09:00", arrivedAt: new Date(), status: "CONFIRMED", urgencyStatus: "NONE" };
    const urgent = { ...normal, id: "urgent", startTime: "11:00", urgencyStatus: "APPROVED" };
    expect(firstPresent([normal, urgent])?.id).toBe("urgent");
    expect(presentQueueOrder([normal, urgent])[0].id).toBe("urgent");
    for (const override of [{ urgencyStatus: "REQUESTED" }, { urgencyStatus: "DECLINED" }, { arrivedAt: null }, { status: "IN_PROGRESS" }])
      expect(firstPresent([normal, { ...urgent, ...override }])?.id).toBe("normal");
  });
});
