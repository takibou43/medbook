import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { signAccessToken } from "../src/utils/jwt";
import { Prisma } from "@prisma/client";
const h = vi.hoisted(() => {
  const rows = new Map<string, any>();
  const roles: Record<string, string> = { d1: "DOCTOR", d2: "DOCTOR", assistant: "ASSISTANT", patient: "PATIENT", owner: "CLINIC_OWNER", admin: "ADMIN" };
  return { rows, roles, db: {
    user: { findUnique: vi.fn(async ({ where }: any) => roles[where.id] ? { id: where.id, role: roles[where.id], isActive: true } : null) },
    doctor: { findUnique: vi.fn(async ({ where }: any) => roles[where.userId] === "DOCTOR" ? { id: `doctor-${where.userId}` } : null) },
    prescriptionSettings: {
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.doctorId) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const { doctorId, ...value } = rows.has(where.doctorId) ? update : create;
        for (const k of ["professional", "show"]) if (value[k] === Prisma.JsonNull) value[k] = null;
        rows.set(where.doctorId, value); return value;
      }),
    },
  } };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
let app: ReturnType<typeof import("../src/app").createApp>;
beforeAll(async () => { app = (await import("../src/app")).createApp(); });
beforeEach(() => { h.rows.clear(); });
const auth = (id: string) => `Bearer ${signAccessToken({ sub: id, role: h.roles[id] as any })}`;
const url = "/api/doctor/prescription-settings";
const value = { language: "fr", professional: { fr: { doctorName: "Médecin Démonstration", address: "Rue Exemple" }, ar: { clinicName: "عيادة تجريبية" } }, show: { clinicName: true, address: false, phone: true, specialty: true } };
describe("doctor-owned prescription settings", () => {
  it("returns defaults, saves, reloads and replaces only the authenticated doctor's settings", async () => {
    const defaults = (await request(app).get(url).set("Authorization", auth("d1"))).body.data;
    expect(defaults).toMatchObject({ language: "ar", show: { clinicName: true, address: true, phone: true, specialty: true } });
    expect((await request(app).put(url).set("Authorization", auth("d1")).send(value)).status).toBe(200);
    expect((await request(app).get(url).set("Authorization", auth("d1"))).body.data).toEqual(value);
    expect((await request(app).get(url).set("Authorization", auth("d2"))).body.data.language).toBe("ar");
    await request(app).put(url).set("Authorization", auth("d1")).send({ language: "ar" });
    expect((await request(app).get(url).set("Authorization", auth("d1"))).body.data.language).toBe("ar");
    expect(h.rows.has("doctor-d2")).toBe(false);
  });
  it("round-trips the independent header preference inside existing JSON without losing professional names", async () => {
    const next = { ...value, headerLanguage: "ar" };
    expect((await request(app).put(url).set("Authorization", auth("d1")).send(next)).status).toBe(200);
    expect((await request(app).get(url).set("Authorization", auth("d1"))).body.data).toEqual(next);
    expect(h.rows.get("doctor-d1").professional.headerLanguage).toBe("ar");
    expect((await request(app).put(url).set("Authorization", auth("d1")).send({ ...next, headerLanguage: "de" })).status).toBe(400);
  });
  it.each(["assistant", "patient", "owner", "admin"])("rejects settings operations from %s", async id => {
    for (const method of ["get", "put"] as const) expect((await request(app)[method](url).set("Authorization", auth(id)).send(method === "put" ? value : undefined)).status).toBe(403);
    expect(h.rows.size).toBe(0);
  });
  it("requires authentication and refuses ownership, unknown languages and patient fields", async () => {
    expect((await request(app).get(url)).status).toBe(401);
    for (const bad of [{ ...value, doctorId: "doctor-d2" }, { ...value, language: "en" }, { ...value, patientName: "x" }, { ...value, professional: { fr: { doctorName: "x".repeat(121) } } }, { ...value, professional: { de: {} } }]) {
      expect((await request(app).put(url).set("Authorization", auth("d1")).send(bad)).status).toBe(400);
    }
    expect(h.rows.size).toBe(0);
  });
});
