/**
 * Regression tests for the 2026-10-25 audit. Every request runs against the
 * real Express routers with synthetic data; Prisma and the account services are
 * replaced with stubs so no database (and never production) is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const h = vi.hoisted(() => {
  const s = {
    userLookup: vi.fn(async ({ where }: any) => ({ id: where.id, role: "PATIENT", isActive: true })),
    registerDoctor: vi.fn(),
    login: vi.fn(),
    loginPatient: vi.fn(),
    patientFind: vi.fn(async () => ({ id: "patient-row" })),
    patientUpdate: vi.fn(async ({ data }: any) => ({ id: "patient-row", ...data })),
    userUpdate: vi.fn(async () => ({})),
    transaction: vi.fn(async (fn: any) => fn(s.db)),
    publicClinic: vi.fn(async () => ({ id: "c" })),
    searchClinics: vi.fn(async () => ({ items: [] })),
    listReviews: vi.fn(async () => []),
    db: {} as any,
  };
  s.db = {
    user: { findUnique: s.userLookup, update: s.userUpdate },
    patient: { findUnique: s.patientFind, update: s.patientUpdate },
    city: { findUnique: vi.fn(async () => ({ id: "city" })) },
    $transaction: s.transaction,
  };
  return s;
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
vi.mock("../src/modules/auth/auth.service", async (orig) => ({
  ...(await orig<object>()),
  registerDoctor: h.registerDoctor,
  login: h.login,
}));
vi.mock("../src/modules/patientAuth/patientAuth.service", async (orig) => ({
  ...(await orig<object>()),
  loginPatient: h.loginPatient,
}));
vi.mock("../src/modules/clinics/clinics.service", async (orig) => ({
  ...(await orig<object>()),
  publicClinic: h.publicClinic,
  searchClinics: h.searchClinics,
}));
vi.mock("../src/modules/reviews/reviews.service", async (orig) => ({
  ...(await orig<object>()),
  listForDoctor: h.listReviews,
}));

import authRoutes from "../src/modules/auth/auth.routes";
import { patientAuthRouter } from "../src/modules/patientAuth/patientAuth.routes";
import patientSelfRoutes from "../src/modules/patients/patientSelf.routes";
import clinicsRoutes from "../src/modules/clinics/clinics.routes";
import reviewsRoutes from "../src/modules/reviews/reviews.routes";
import { errorHandler } from "../src/middleware/errorHandler";
import { validate } from "../src/middleware/validate";
import { signAccessToken } from "../src/utils/jwt";
import { z } from "zod";

function makeApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use("/auth", authRoutes);
  app.use("/patient/auth", patientAuthRouter);
  app.use("/patient", patientSelfRoutes);
  app.use("/clinics", clinicsRoutes);
  app.use("/reviews", reviewsRoutes);
  app.use(errorHandler);
  return app;
}
const app = makeApp();
const id = "11111111-1111-4111-8111-111111111111";
const patientToken = (sub: string) => `Bearer ${signAccessToken({ sub, role: "PATIENT" })}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("oversized arrays are rejected before Zod builds per-element issues", () => {
  const doctor = { email: "new-doctor@example.test", password: "password123", firstName: "Amine", lastName: "Saidi", wilayaId: id, cityId: id };

  it("public doctor registration answers a 2MB invalid array with a small 400 and never reaches the service", async () => {
    const languages = new Array(400_000).fill(0);
    const started = Date.now();
    const res = await request(app).post("/auth/register/doctor").set("X-Forwarded-For", "198.51.100.200").send({ ...doctor, languages });
    expect(res.status).toBe(400);
    // Before the fix Zod produced one issue per element and the response was tens of MB.
    expect(res.text.length).toBeLessThan(5_000);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(h.registerDoctor).not.toHaveBeenCalled();
  });

  it("caps the number of reported validation issues", async () => {
    const schema = z.object(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}`, z.string()])));
    const small = express();
    small.use(express.json());
    small.post("/x", validate({ body: schema }), (_req, res) => res.json({ ok: true }));
    small.use(errorHandler);
    const res = await request(small).post("/x").send({});
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeLessThanOrEqual(20);
  });

  it("still accepts legitimate arrays", async () => {
    const schema = z.object({ ids: z.array(z.string().uuid()).max(1000) });
    const small = express();
    small.use(express.json());
    small.post("/x", validate({ body: schema }), (req, res) => res.json({ n: req.body.ids.length }));
    small.use(errorHandler);
    const res = await request(small).post("/x").send({ ids: new Array(1000).fill(id) });
    expect(res.status).toBe(200);
    expect(res.body.n).toBe(1000);
  });

  it("rejects deeply nested bodies", async () => {
    const schema = z.object({ a: z.any() });
    const small = express();
    small.use(express.json());
    small.post("/x", validate({ body: schema }), (_req, res) => res.json({ ok: true }));
    small.use(errorHandler);
    let nested: any = 1;
    for (let i = 0; i < 100; i++) nested = { a: nested };
    expect((await request(small).post("/x").send(nested)).status).toBe(400);
  });
});

describe("password guessing is limited per account, not only per IP", () => {
  it.each([
    ["/auth/login", () => h.login],
    ["/patient/auth/login", () => h.loginPatient],
  ])("%s blocks an account after repeated failures from many IPs", async (path, svc) => {
    const { ApiError } = await import("../src/utils/ApiError");
    svc().mockRejectedValue(ApiError.unauthorized("bad"));
    const email = `victim-${path.length}@example.test`;
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post(path).set("X-Forwarded-For", `203.0.113.${i + 1}`).send({ email, password: `guess-${i}` });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app).post(path).set("X-Forwarded-For", "203.0.113.99").send({ email: email.toUpperCase(), password: "guess-x" });
    expect(blocked.status).toBe(429);
    // Another account behind the same IPs is unaffected.
    const other = await request(app).post(path).set("X-Forwarded-For", "203.0.113.1").send({ email: `other-${path.length}@example.test`, password: "x" });
    expect(other.status).toBe(401);
  });

  it("successful logins behind one shared (CGNAT) IP do not exhaust the IP budget", async () => {
    h.login.mockResolvedValue({ user: { id: "u", role: "DOCTOR" }, accessToken: "a", refreshToken: "r" });
    for (let i = 0; i < 40; i++) {
      const r = await request(app).post("/auth/login").set("X-Forwarded-For", "192.0.2.50").send({ email: `user${i}@example.test`, password: "password123" });
      expect(r.status).toBe(200);
    }
  });
});

describe("patient phone changes", () => {
  it("rejects a non-Algerian phone format", async () => {
    const res = await request(app).patch("/patient/profile").set("Authorization", patientToken("p-format")).send({ phone: "not-a-phone" });
    expect(res.status).toBe(400);
    expect(h.userUpdate).not.toHaveBeenCalled();
  });

  it("accepts a valid phone and writes profile and phone together", async () => {
    const res = await request(app).patch("/patient/profile").set("Authorization", patientToken("p-ok")).send({ phone: "0551234567", gender: "MALE" });
    expect(res.status).toBe(200);
    expect(h.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { phone: "0551234567" } }));
    expect(h.transaction).toHaveBeenCalled();
  });

  it("limits how many phone numbers one account can try (registered-number oracle)", async () => {
    const token = patientToken("p-oracle");
    for (let i = 0; i < 5; i++) {
      const r = await request(app).patch("/patient/profile").set("Authorization", token).send({ phone: `05512345${10 + i}` });
      expect(r.status).toBe(200);
    }
    expect((await request(app).patch("/patient/profile").set("Authorization", token).send({ phone: "0551234599" })).status).toBe(429);
    // Area-only updates (the only thing the patient UI sends) are not affected.
    expect((await request(app).patch("/patient/profile").set("Authorization", token).send({ cityId: id })).status).toBe(200);
  });
});

describe("public clinic and review reads share the discovery burst limit", () => {
  it("throttles rapid public clinic/review scraping", async () => {
    const ip = "198.51.100.77";
    let last = 0;
    for (let i = 0; i < 121; i++) {
      const path = i % 3 === 0 ? `/clinics/${id}` : i % 3 === 1 ? "/clinics" : `/reviews/doctor/${id}`;
      last = (await request(app).get(path).set("X-Forwarded-For", ip)).status;
    }
    expect(last).toBe(429);
  });

  it("rejects a non-UUID doctor id on public reviews", async () => {
    expect((await request(app).get("/reviews/doctor/not-a-uuid").set("X-Forwarded-For", "198.51.100.78")).status).toBe(400);
    expect(h.listReviews).not.toHaveBeenCalled();
  });
});
