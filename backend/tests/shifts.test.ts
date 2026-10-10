import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
const db = vi.hoisted(() => ({ doctor: { findUniqueOrThrow: vi.fn() }, assistant: { findUnique: vi.fn(), findFirst: vi.fn() } }));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/lib/actingDoctor", () => ({ resolveActingDoctorId: vi.fn(async () => "doctor-1") }));
import { assertReception, hasOnDutyAssistant } from "../src/modules/shifts/shifts.service";
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
