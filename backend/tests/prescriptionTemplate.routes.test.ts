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
    prescriptionTemplate: {
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.doctorId) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => { const { doctorId, ...value } = rows.has(where.doctorId) ? update : create; if (value.design === Prisma.JsonNull) value.design = null; rows.set(where.doctorId, value); return value; }),
      deleteMany: vi.fn(async ({ where }: any) => { rows.delete(where.doctorId); return { count: 1 }; }),
    },
  } };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
let app: ReturnType<typeof import("../src/app").createApp>;
beforeAll(async () => { app = (await import("../src/app")).createApp(); });
beforeEach(() => { h.rows.clear(); });
const auth = (id: string) => `Bearer ${signAccessToken({ sub: id, role: h.roles[id] as any })}`;
const url = "/api/doctor/prescription-template";
const value = { image: `data:image/jpeg;base64,${Buffer.concat([Buffer.from([255,216,255]), Buffer.alloc(120), Buffer.from([255,217])]).toString("base64")}`, top: 40, bottom: 30, side: 12 };
describe("doctor-owned blank prescription templates", () => {
  it("reloads design settings for later edits and clears stale settings when replaced with an uploaded sheet", async () => {
    const design = { version: 1, language: "fr", doctorName: "Médecin Démonstration", specialty: "", clinicName: "", address: "", phone: "", footer: "", color: "#187f77", layout: "centered", logo: null, logoPosition: "right", headerSize: 18 };
    expect((await request(app).put(url).set("Authorization", auth("d1")).send({ ...value, design })).status).toBe(200);
    expect((await request(app).get(url).set("Authorization", auth("d1"))).body.data.design).toEqual(design);
    await request(app).put(url).set("Authorization", auth("d1")).send({ ...value, design: { ...design, color: "#125678", doctorName: "Updated" } });
    expect((await request(app).get(url).set("Authorization", auth("d1"))).body.data.design).toMatchObject({ color: "#125678", doctorName: "Updated" });
    expect((await request(app).get(url).set("Authorization", auth("d2"))).body.data).toBeNull();
    await request(app).put(url).set("Authorization", auth("d1")).send(value);
    expect((await request(app).get(url).set("Authorization", auth("d1"))).body.data.design).toBeNull();
  });
  it("saves, reloads, replaces and deletes only the authenticated doctor's template", async () => {
    expect((await request(app).put(url).set("Authorization", auth("d1")).send(value)).status).toBe(200);
    expect((await request(app).get(url).set("Authorization", auth("d1"))).body.data).toEqual({ ...value, design: null });
    expect((await request(app).get(url).set("Authorization", auth("d2"))).body.data).toBeNull();
    expect((await request(app).put(url).set("Authorization", auth("d1")).send({ ...value, top: 50 })).status).toBe(200);
    expect(h.rows.get("doctor-d1").top).toBe(50);
    await request(app).put(url).set("Authorization", auth("d2")).send(value);
    expect((await request(app).delete(url).set("Authorization", auth("d1"))).status).toBe(200);
    expect(h.rows.has("doctor-d1")).toBe(false);
    expect(h.rows.has("doctor-d2")).toBe(true);
  });
  it.each(["assistant", "patient", "owner", "admin"])("rejects all template operations from %s", async id => {
    for (const method of ["get", "put", "delete"] as const) expect((await request(app)[method](url).set("Authorization", auth(id)).send(method === "put" ? value : undefined)).status).toBe(403);
    expect(h.rows.size).toBe(0);
  });
  it("requires authentication and refuses ownership or patient fields", async () => {
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).put(url).set("Authorization", auth("d1")).send({ ...value, doctorId: "doctor-d2" })).status).toBe(400);
    expect((await request(app).put(url).set("Authorization", auth("d1")).send({ ...value, patientName: "example" })).status).toBe(400);
    expect(h.rows.size).toBe(0);
  });
});
