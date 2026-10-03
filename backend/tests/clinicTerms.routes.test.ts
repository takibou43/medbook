/**
 * صلاحيات وخصوصية أسعار الأطباء ونسبهم داخل العيادات — طلبات HTTP حقيقية (Express + JWT + Zod) مع Prisma في الذاكرة.
 * المطلوب: المدير وحده يحدد ويعدّل، لا نسبة عيادة تُقبل من العميل، والطبيب يرى شروطه هو فقط، والمساعد لا يصل.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { signAccessToken } from "../src/utils/jwt";

const h = vi.hoisted(() => {
  const users: Record<string, { id: string; role: string; isActive: boolean }> = {
    owner: { id: "owner", role: "CLINIC_OWNER", isActive: true },
    owner2: { id: "owner2", role: "CLINIC_OWNER", isActive: true },
    doc1: { id: "doc1", role: "DOCTOR", isActive: true },
    doc2: { id: "doc2", role: "DOCTOR", isActive: true },
    docOut: { id: "docOut", role: "DOCTOR", isActive: true },
    asst: { id: "asst", role: "ASSISTANT", isActive: true },
    patient: { id: "patient", role: "PATIENT", isActive: true },
    admin: { id: "admin", role: "ADMIN", isActive: true },
  };
  const D1 = "11111111-1111-4111-8111-111111111111";
  const D2 = "22222222-2222-4222-8222-222222222222";
  const OUT = "33333333-3333-4333-8333-333333333333";
  const state = {
    terms: new Map<string, any>(),
    audit: [] as any[],
    upserts: 0,
  };
  const doctors: Record<string, any> = {
    [D1]: { id: D1, userId: "doc1", clinicId: "c1", consultationFee: 1500, nameAr: "أ" },
    [D2]: { id: D2, userId: "doc2", clinicId: "c1", consultationFee: 1800, nameAr: "ب" },
    [OUT]: { id: OUT, userId: "docOut", clinicId: null, consultationFee: 1200, nameAr: "ج" },
  };
  const db: any = {
    user: { findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null) },
    clinic: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.ownerId === "owner") return { id: "c1", ownerId: "owner", owner: { isActive: true } };
        if (where.ownerId === "owner2") return { id: "c2", ownerId: "owner2", owner: { isActive: true } };
        return null;
      }),
    },
    doctor: {
      findFirst: vi.fn(async ({ where }: any) => {
        const d = doctors[where.id];
        return d && d.clinicId === where.clinicId ? { ...d, clinicTerms: state.terms.get(d.id) ?? null } : null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const d = Object.values(doctors).find(x => x.userId === where.userId);
        if (!d) return null;
        return { clinicId: d.clinicId, consultationFee: d.consultationFee, clinicTerms: state.terms.get(d.id) ?? null, clinic: d.clinicId ? { nameAr: "عيادة", ownerId: "owner" } : null };
      }),
    },
    clinicDoctorTerms: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        state.upserts++;
        const prev = state.terms.get(where.doctorId);
        const next = prev ? { ...prev, ...update } : { id: `t-${where.doctorId}`, appointmentPriceDzd: null, doctorSharePercent: null, ...create };
        state.terms.set(where.doctorId, next);
        return next;
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => { state.audit.push(data); return data; }) },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return { db, state, D1, D2, OUT };
});

vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));

let app: ReturnType<typeof import("../src/app").createApp>;
const token = (id: string) => `Bearer ${signAccessToken({ sub: id, role: ({ owner: "CLINIC_OWNER", owner2: "CLINIC_OWNER", doc1: "DOCTOR", doc2: "DOCTOR", docOut: "DOCTOR", asst: "ASSISTANT", patient: "PATIENT", admin: "ADMIN" } as any)[id] })}`;
const patchTerms = (who: string | null, doctorId: string, body: unknown) => {
  const r = request(app).patch(`/api/clinics/mine/doctors/${doctorId}/terms`);
  return (who ? r.set("Authorization", token(who)) : r).send(body as object);
};

beforeAll(async () => { app = (await import("../src/app")).createApp(); });
beforeEach(() => { h.state.terms.clear(); h.state.audit.length = 0; h.state.upserts = 0; });

describe("PATCH /api/clinics/mine/doctors/:id/terms — الصلاحيات", () => {
  it("مدير العيادة يحدد السعر ونسبة الطبيب ونسبة العيادة تُحسب", async () => {
    const res = await patchTerms("owner", h.D1, { appointmentPriceDzd: 2000, doctorSharePercent: 80 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ appointmentPriceDzd: 2000, priceSource: "CLINIC", doctorSharePercent: 80, clinicSharePercent: 20 });
    expect(h.state.audit).toHaveLength(1);
    expect(h.state.audit[0]).toMatchObject({ action: "CLINIC_DOCTOR_TERMS_UPDATED", userId: "owner" });
  });
  it("نسبتان مختلفتان لطبيبين في العيادة نفسها بشكل مستقل", async () => {
    await patchTerms("owner", h.D1, { appointmentPriceDzd: 2000, doctorSharePercent: 80 });
    const r2 = await patchTerms("owner", h.D2, { appointmentPriceDzd: 2500, doctorSharePercent: 85 });
    expect(r2.body.data).toMatchObject({ appointmentPriceDzd: 2500, doctorSharePercent: 85, clinicSharePercent: 15 });
    expect(h.state.terms.get(h.D1)).toMatchObject({ appointmentPriceDzd: 2000, doctorSharePercent: 80 });
  });
  it("تعديل لاحق لحقل واحد يُبقي الآخر", async () => {
    await patchTerms("owner", h.D1, { appointmentPriceDzd: 2000, doctorSharePercent: 80 });
    const res = await patchTerms("owner", h.D1, { doctorSharePercent: 75 });
    expect(res.body.data).toMatchObject({ appointmentPriceDzd: 2000, doctorSharePercent: 75, clinicSharePercent: 25 });
  });
  it("مدير عيادة أخرى لا يستطيع تعديل طبيب ليس في عيادته (404) ولا يُكتب شيء", async () => {
    const res = await patchTerms("owner2", h.D1, { appointmentPriceDzd: 1, doctorSharePercent: 1 });
    expect(res.status).toBe(404);
    expect(h.state.upserts).toBe(0);
  });
  it("طبيب مستقل خارج أي عيادة لا يظهر لأي مدير", async () => {
    expect((await patchTerms("owner", h.OUT, { doctorSharePercent: 50 })).status).toBe(404);
    expect(h.state.upserts).toBe(0);
  });
  it.each(["doc1", "doc2", "docOut", "asst", "patient", "admin"])("%s لا يستطيع التعديل", async who => {
    const res = await patchTerms(who, h.D1, { appointmentPriceDzd: 1, doctorSharePercent: 1 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.state.upserts).toBe(0);
  });
  it("بلا تسجيل دخول 401", async () => {
    expect((await patchTerms(null, h.D1, { doctorSharePercent: 50 })).status).toBe(401);
    expect(h.state.upserts).toBe(0);
  });
});

describe("PATCH terms — صحة القيم في الخادم", () => {
  it.each([
    [{ doctorSharePercent: 101 }], [{ doctorSharePercent: -1 }], [{ doctorSharePercent: 80.5 }], [{ doctorSharePercent: "80" }],
    [{ appointmentPriceDzd: -1 }], [{ appointmentPriceDzd: 20.5 }], [{ appointmentPriceDzd: "abc" }], [{}],
    [{ appointmentPriceDzd: 2000, clinicSharePercent: 20 }],
    [{ appointmentPriceDzd: 2000, doctorSharePercent: 80, doctorId: "x" }],
  ])("يرفض %j بـ 400 ولا يكتب", async body => {
    const res = await patchTerms("owner", h.D1, body);
    expect(res.status).toBe(400);
    expect(h.state.upserts).toBe(0);
  });
  it("معرّف طبيب غير صالح 400", async () => {
    expect((await patchTerms("owner", "not-a-uuid", { doctorSharePercent: 50 })).status).toBe(400);
  });
  it("الحدّان 0 و100 مقبولان، ونسبة العيادة تُحسب", async () => {
    expect((await patchTerms("owner", h.D1, { doctorSharePercent: 0 })).body.data.clinicSharePercent).toBe(100);
    expect((await patchTerms("owner", h.D1, { doctorSharePercent: 100 })).body.data.clinicSharePercent).toBe(0);
  });
});

describe("GET /api/doctor/clinic-terms — الطبيب يرى شروطه هو فقط", () => {
  beforeEach(async () => {
    await patchTerms("owner", h.D1, { appointmentPriceDzd: 2000, doctorSharePercent: 80 });
    await patchTerms("owner", h.D2, { appointmentPriceDzd: 2500, doctorSharePercent: 85 });
  });
  const mine = (who: string) => request(app).get("/api/doctor/clinic-terms").set("Authorization", token(who));
  it("كل طبيب يرى سعره ونسبته فقط", async () => {
    const a = await mine("doc1");
    expect(a.status).toBe(200);
    expect(a.body.data).toMatchObject({ inClinic: true, appointmentPriceDzd: 2000, doctorSharePercent: 80, clinicSharePercent: 20 });
    const b = await mine("doc2");
    expect(b.body.data).toMatchObject({ appointmentPriceDzd: 2500, doctorSharePercent: 85, clinicSharePercent: 15 });
  });
  it("لا أثر لنسبة زميله في استجابته", async () => {
    const text = JSON.stringify((await mine("doc1")).body);
    expect(text).not.toContain("85"); expect(text).not.toContain("2500"); expect(text).not.toContain(h.D2);
  });
  it("طبيب مستقل: inClinic=false بلا أرقام", async () => {
    expect((await mine("docOut")).body.data).toEqual({ inClinic: false });
  });
  it("المساعد والمريض والمدير الإداري لا يصلون", async () => {
    for (const who of ["asst", "patient", "admin"]) expect((await mine(who)).status).toBe(403);
  });
  it("طبيب في عيادة لم تُحدَّد نسبته: السعر الحالي ونسبة null (لا افتراض)", async () => {
    h.state.terms.clear();
    const res = await mine("doc1");
    expect(res.body.data).toMatchObject({ inClinic: true, appointmentPriceDzd: 1500, doctorSharePercent: null, clinicSharePercent: null });
  });
});
