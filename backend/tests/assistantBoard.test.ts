import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ assistant: { findUnique: vi.fn() }, doctor: { findMany: vi.fn() }, queue: vi.fn(), appointments: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ prisma: mock }));
vi.mock("../src/modules/appointments/appointments.service", () => ({ getQueueForDoctor: mock.queue, listForDoctor: mock.appointments }));
import { assistantDoctorContext } from "../src/lib/assistantDoctorContext";
import { assistantAppointments, assistantQueues } from "../src/modules/assistants/assistantBoard.service";
describe("assistant unified board", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.assistant.findUnique.mockResolvedValue({ isActive: true, clinicId: "clinic", allDoctors: true, doctor: { user: { isActive: false } } });
    mock.doctor.findMany.mockResolvedValue([{ id: "one", firstName: "One" }, { id: "two", firstName: "Two" }]);
    mock.queue.mockImplementation(async () => { await Promise.resolve(); return { current: { doctorId: assistantDoctorContext.getStore() } }; });
    mock.appointments.mockImplementation(async () => { await Promise.resolve(); const id = assistantDoctorContext.getStore(); return [{ id, doctorId: id, startTime: id === "one" ? "10:00" : "09:00", familyMemberId: "child" }]; });
  });
  it("returns both doctor calls with isolated contexts, ignoring a stale client selection", async () => {
    const rows = await assistantDoctorContext.run("foreign", () => assistantQueues("helper"));
    expect(rows.map(row => row.queue.current?.doctorId)).toEqual(["one", "two"]);
    expect(mock.doctor.findMany.mock.calls[0][0].where).toEqual({ clinicId: "clinic", user: { isActive: true } });
  });
  it("sorts appointments across doctors and preserves beneficiary identity", async () => {
    const rows = await assistantAppointments("helper", "2026-10-04");
    expect(rows.map(row => [row.doctorId, row.doctor.id, row.familyMemberId])).toEqual([["two", "two", "child"], ["one", "one", "child"]]);
    expect(mock.appointments).toHaveBeenCalledWith("helper", "ASSISTANT", undefined, "2026-10-04");
  });
  it("intersects restricted assignments with live clinic and active doctor membership", async () => {
    mock.assistant.findUnique.mockResolvedValue({ isActive: true, clinicId: "clinic", allDoctors: false, allowedDoctorIds: ["one"], doctor: { user: { isActive: true } } });
    mock.doctor.findMany.mockResolvedValue([{ id: "one" }]);
    await assistantQueues("helper");
    expect(mock.doctor.findMany.mock.calls[0][0].where).toEqual({ clinicId: "clinic", id: { in: ["one"] }, user: { isActive: true } });
    expect(mock.queue).toHaveBeenCalledTimes(1);
  });
  it("refuses disabled assistants before any appointment lookup", async () => {
    mock.assistant.findUnique.mockResolvedValue({ isActive: false });
    await expect(assistantQueues("helper")).rejects.toMatchObject({ statusCode: 403 });
    expect(mock.queue).not.toHaveBeenCalled();
  });
  it("restricts independent assistants to their active original doctor", async () => {
    mock.assistant.findUnique.mockResolvedValue({ isActive: true, clinicId: null, doctorId: "one", doctor: { user: { isActive: true } } });
    await assistantQueues("helper");
    expect(mock.doctor.findMany.mock.calls[0][0].where).toEqual({ id: "one", user: { isActive: true } });
    mock.assistant.findUnique.mockResolvedValue({ isActive: true, clinicId: null, doctorId: "one", doctor: { user: { isActive: false } } });
    await expect(assistantAppointments("helper", "2026-10-04")).rejects.toMatchObject({ statusCode: 403 });
  });
});
