import { describe, expect, it, vi } from "vitest";
import { resolveSpecialtyId, specialtyNameSchema } from "../src/lib/specialtySelection";
import catalog from "../src/data/algeria-specialties.json";

function database() {
  return { specialty: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() } };
}
describe("doctor specialty selection", () => {
  it("keeps the existing specialty ID when selected", async () => {
    const db = database();
    db.specialty.findUnique.mockResolvedValue({ id: "existing" });
    expect(await resolveSpecialtyId(db as any, { specialtyId: "existing" })).toBe("existing");
    expect(db.specialty.upsert).not.toHaveBeenCalled();
  });
  it("reuses a typed Arabic or French specialty without adding a duplicate", async () => {
    for (const specialtyName of ["طب القلب", "Cardiologie"]) {
      const db = database();
      db.specialty.findFirst.mockResolvedValue({ id: "cardiology" });
      expect(await resolveSpecialtyId(db as any, { specialtyName })).toBe("cardiology");
      expect(db.specialty.findFirst).toHaveBeenCalledWith({ where: { OR: expect.arrayContaining([
        { nameAr: { equals: specialtyName, mode: "insensitive" } }, { nameFr: { equals: specialtyName, mode: "insensitive" } },
      ]) }, select: { id: true } });
      expect(db.specialty.upsert).not.toHaveBeenCalled();
    }
  });
  it("saves a new typed specialty after normalizing whitespace", async () => {
    const db = database();
    db.specialty.findFirst.mockResolvedValue(null);
    db.specialty.upsert.mockResolvedValue({ id: "new" });
    expect(await resolveSpecialtyId(db as any, { specialtyName: "  تخصص   جديد  " })).toBe("new");
    expect(db.specialty.upsert).toHaveBeenCalledWith({ where: { nameAr: "تخصص جديد" }, update: {}, create: { nameAr: "تخصص جديد", icon: "stethoscope" }, select: { id: true } });
  });
  it("rejects missing, invalid, ambiguous, and unknown selections", async () => {
    const db = database();
    for (const input of [{}, { specialtyName: " " }, { specialtyName: "<script>" }, { specialtyName: "a".repeat(121) }, { specialtyId: "id", specialtyName: "طب القلب" }, { specialtyId: "unknown" }]) {
      await expect(resolveSpecialtyId(db as any, input)).rejects.toThrow();
    }
    expect(db.specialty.upsert).not.toHaveBeenCalled();
    expect(specialtyNameSchema.safeParse("الأنف والأذن والحنجرة").success).toBe(true);
  });
  it("creates the same bilingual catalog entry when its French label is typed", async () => {
    const db = database();
    db.specialty.findFirst.mockResolvedValue(null);
    db.specialty.upsert.mockResolvedValue({ id: "new" });
    await resolveSpecialtyId(db as any, { specialtyName: "Gériatrie" });
    expect(db.specialty.upsert).toHaveBeenCalledWith({ where: { nameAr: "طب الشيخوخة" }, update: {}, create: { nameAr: "طب الشيخوخة", nameFr: "Gériatrie", icon: "stethoscope" }, select: { id: true } });
  });
  it("preserves the original catalog labels and has no duplicate entries", () => {
    expect(new Set(catalog.map(s => s[0])).size).toBe(catalog.length);
    expect(new Set(catalog.map(s => s[1])).size).toBe(catalog.length);
    expect(catalog).toContainEqual(["طب الأسنان", "Dentisterie"]);
    expect(catalog).toContainEqual(["طب النساء والتوليد", "Gynécologie"]);
  });
});
