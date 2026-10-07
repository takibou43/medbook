import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ doctor: { findUnique: vi.fn() }, assistant: { findFirst: vi.fn() } }));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/lib/actingDoctor", () => ({ resolveActingDoctorId: vi.fn(async () => "doctor-1") }));
import { attendanceResponsibility } from "../src/modules/assistants/assistants.service";

describe("attendance responsibility (mocked database)", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("keeps attendance with a doctor who has no active assistant", async () => {
    db.doctor.findUnique.mockResolvedValue({ clinicId: null });
    db.assistant.findFirst.mockResolvedValue(null);
    expect(await attendanceResponsibility("user-1")).toEqual({ hasActiveAssistant: false });
    expect(db.assistant.findFirst).toHaveBeenCalledWith({
      where: { isActive: true, user: { isActive: true }, OR: [{ doctorId: "doctor-1", clinicId: null }] },
      select: { id: true },
    });
  });
  it("recognizes shared clinic assistants without considering other clinics", async () => {
    db.doctor.findUnique.mockResolvedValue({ clinicId: "clinic-1" });
    db.assistant.findFirst.mockResolvedValue({ id: "assistant-1" });
    expect(await attendanceResponsibility("user-1")).toEqual({ hasActiveAssistant: true });
    expect(db.assistant.findFirst).toHaveBeenCalledWith({
      where: { isActive: true, user: { isActive: true }, OR: [
        { doctorId: "doctor-1", clinicId: null },
        { clinicId: "clinic-1", OR: [{ allDoctors: true }, { allDoctors: false, allowedDoctorIds: { has: "doctor-1" } }] },
      ] },
      select: { id: true },
    });
  });
});
