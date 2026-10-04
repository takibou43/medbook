import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
const db = vi.hoisted(() => ({ assistant: { findUnique: vi.fn() }, doctor: { findFirst: vi.fn(), findUnique: vi.fn() } }));
vi.mock("../src/lib/prisma", () => ({ prisma: db }));
import { resolveActingDoctorId } from "../src/lib/actingDoctor";
import { assistantDoctorContext } from "../src/lib/assistantDoctorContext";

describe("clinic assistant authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.assistant.findUnique.mockResolvedValue({ doctorId: "inviter", clinicId: "clinic-a", isActive: true, doctor: { user: { isActive: true } } });
  });
  it("allows another doctor only through a live clinic membership query", async () => {
    db.doctor.findFirst.mockResolvedValue({ id: "colleague" });
    await expect(assistantDoctorContext.run("colleague", () => resolveActingDoctorId("assistant", Role.ASSISTANT))).resolves.toBe("colleague");
    expect(db.doctor.findFirst).toHaveBeenCalledWith({ where: { AND: [{ clinicId: "clinic-a", user: { isActive: true } }, { id: "colleague" }] }, select: { id: true }, orderBy: { id: "asc" } });
  });
  it("rejects a foreign, transferred or inactive doctor", async () => {
    db.doctor.findFirst.mockResolvedValue(null);
    await expect(assistantDoctorContext.run("foreign", () => resolveActingDoctorId("assistant", Role.ASSISTANT))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("revokes all doctors when the assistant is disabled", async () => {
    db.assistant.findUnique.mockResolvedValue({ isActive: false });
    await expect(assistantDoctorContext.run("colleague", () => resolveActingDoctorId("assistant", Role.ASSISTANT))).rejects.toMatchObject({ statusCode: 403 });
    expect(db.doctor.findFirst).not.toHaveBeenCalled();
  });
  it("keeps independent assistants restricted to their own doctor", async () => {
    db.assistant.findUnique.mockResolvedValue({ doctorId: "independent", clinicId: null, isActive: true, doctor: { user: { isActive: true } } });
    await expect(resolveActingDoctorId("assistant", Role.ASSISTANT)).resolves.toBe("independent");
    await expect(assistantDoctorContext.run("foreign", () => resolveActingDoctorId("assistant", Role.ASSISTANT))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("isolates simultaneous selections", async () => {
    db.doctor.findFirst.mockImplementation(async ({ where }) => { await Promise.resolve(); return { id: where.AND[1].id }; });
    const results = await Promise.all(["first", "second"].map(id => assistantDoctorContext.run(id, async () => { await Promise.resolve(); return resolveActingDoctorId("assistant", Role.ASSISTANT); })));
    expect(results).toEqual(["first", "second"]);
  });
  it("intersects a restricted assignment with clinic membership on every request", async () => {
    db.assistant.findUnique.mockResolvedValue({ doctorId: "inviter", clinicId: "clinic-a", allDoctors: false, allowedDoctorIds: ["assigned"], isActive: true, doctor: { user: { isActive: false } } });
    db.doctor.findFirst.mockResolvedValue({ id: "assigned" });
    await expect(resolveActingDoctorId("assistant", Role.ASSISTANT)).resolves.toBe("assigned");
    expect(db.doctor.findFirst).toHaveBeenCalledWith({ where: { AND: [{ clinicId: "clinic-a", id: { in: ["assigned"] }, user: { isActive: true } }] }, select: { id: true }, orderBy: { id: "asc" } });
  });
});
