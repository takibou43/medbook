import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
const db = vi.hoisted(() => ({ doctor: { findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, assistant: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn() }, $transaction: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/lib/actingDoctor", () => ({ resolveActingDoctorId: vi.fn(async () => "doctor-1") }));
vi.mock("../src/lib/doctorLock", () => ({ lockDoctorCalls: vi.fn() }));
vi.mock("../src/lib/audit", () => ({ writeAudit: vi.fn() }));
import { setShift, heartbeatShift, assertReception, hasOnDutyAssistant } from "../src/modules/shifts/shifts.service";
describe("shift reception responsibility", () => {
  beforeEach(() => { vi.clearAllMocks(); db.doctor.findUniqueOrThrow.mockResolvedValue({ clinicId: "clinic-1" }); });
  it("rejects assistants before starting and after expiry", async () => {
    for (const shiftEndsAt of [null, new Date(Date.now() - 1000)]) {
      db.assistant.findUnique.mockResolvedValue({ isActive: true, shiftEndsAt });
      await expect(assertReception("a", Role.ASSISTANT, "doctor-1")).rejects.toThrow();
    }
  });
  it("allows an assistant who manually started a valid shift", async () => {
    db.assistant.findUnique.mockResolvedValue({ isActive: true, shiftEndsAt: new Date(Date.now() + 60000) });
    await expect(assertReception("a", Role.ASSISTANT, "doctor-1")).resolves.toBeUndefined();
  });
  it("allows doctor fallback only when no scoped assistant is on duty", async () => {
    db.assistant.findFirst.mockResolvedValue(null);
    await expect(assertReception("d", Role.DOCTOR, "doctor-1")).resolves.toBeUndefined();
    db.assistant.findFirst.mockResolvedValue({ id: "a" });
    await expect(assertReception("d", Role.DOCTOR, "doctor-1")).rejects.toThrow();
  });
  it("checks shift expiry and shared clinic assignments together", async () => {
    await hasOnDutyAssistant("doctor-1");
    expect(db.assistant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      shiftEndsAt: { gt: expect.any(Date) },
      OR: expect.arrayContaining([expect.objectContaining({ clinicId: "clinic-1" })]),
    }) }));
  });
});

describe("doctor live availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async fn => fn(db));
    db.doctor.findUniqueOrThrow.mockResolvedValue({ clinicId: null, schedules: [], dutyEndsAt: null });
    db.assistant.findFirst.mockResolvedValue(null);
  });
  it("starts on demand without a schedule or end-time input", async () => {
    const before = Date.now();
    await setShift("d", Role.DOCTOR, undefined);
    const value = db.doctor.update.mock.calls[0][0].data.dutyEndsAt.getTime();
    expect(value).toBeGreaterThanOrEqual(before + 90000);
    expect(value).toBeLessThanOrEqual(Date.now() + 90000);
  });
  it("ending manually clears the pending call and availability", async () => {
    await setShift("d", Role.DOCTOR, null);
    expect(db.doctor.update).toHaveBeenCalledWith({ where: { id: "doctor-1" }, data: { dutyEndsAt: null, queueRequestedAt: null } });
  });
  it("a delayed heartbeat cannot restart expired or manually ended duty", async () => {
    db.doctor.updateMany.mockResolvedValue({ count: 0 });
    const state = await heartbeatShift("d", Role.DOCTOR);
    expect(state.active).toBe(false);
    expect(db.doctor.updateMany.mock.calls[0][0].where.dutyEndsAt.gt).toBeInstanceOf(Date);
    expect(db.doctor.update).not.toHaveBeenCalled();
    expect(db.doctor.updateMany.mock.calls[0][0].data.queueRequestedAt).toBeUndefined();
  });
  it("rejects assistant heartbeats", async () => {
    await expect(heartbeatShift("a", Role.ASSISTANT)).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
