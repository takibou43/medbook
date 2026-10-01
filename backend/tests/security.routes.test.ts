/**
 * تدقيق أمني — اختبارات HTTP حقيقية (Express + Zod + JWT) مع Prisma في الذاكرة فقط.
 * المخزن الوهمي يطبّق `select` كما تفعل Prisma، حتى يثبت الاختبار أن الحقول المحذوفة لا تصل للرد فعلًا.
 *
 * يغطي: تتبّع حجز الضيف (lookup/cancel)، صلاحيات مسارات الإدارة، مدخلات PATCH (صحيحة/خاطئة/حقول زائدة)،
 * غياب userId من /api/doctors العام، وتغيير البريد الإلكتروني.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { signAccessToken } from "../src/utils/jwt";

const h = vi.hoisted(() => {
  /** يطبّق select بأسلوب Prisma على كائن عادي (تداخل العلاقات مدعوم). */
  const applySelect = (row: any, select: any): any => {
    if (!row || !select) return row;
    if (Array.isArray(row)) return row.map((r) => applySelect(r, select));
    const out: any = {};
    for (const [k, v] of Object.entries(select)) {
      if (!v) continue;
      if (v === true) out[k] = row[k];
      else if (typeof v === "object") out[k] = applySelect(row[k], (v as any).select ?? null);
    }
    return out;
  };
  const future = new Date(Date.now() + 3 * 86_400_000);
  future.setUTCHours(0, 0, 0, 0);

  const s = {
    appts: [] as any[],
    doctors: [] as any[],
    users: [] as any[],
    tokens: [] as any[],
    audit: [] as any[],
  };

  const DOCTOR = () => ({
    id: "11111111-1111-4111-8111-111111111111",
    userId: "doctor-user-secret-id",
    firstName: "أمين",
    lastName: "بوزيد",
    specialtyId: "sp-1",
    specialty: { id: "sp-1", nameAr: "طب عام", nameFr: null, icon: null, description: null },
    clinicId: null,
    clinic: null,
    wilayaId: "w-1",
    wilaya: { id: "w-1", code: "43", nameAr: "ميلة", nameFr: "Mila" },
    cityId: "c-1",
    city: { id: "c-1", nameAr: "ميلة", wilayaId: "w-1" },
    bio: null,
    yearsExperience: 5,
    languages: ["ar"],
    gender: "MALE",
    phone: "0550000001",
    address: "حي 100 مسكن",
    consultationFee: 1500,
    photoUrl: null,
    latitude: null,
    longitude: null,
    slotDurationMin: 7,
    verificationStatus: "VERIFIED",
    subscriptionStatus: "ACTIVE",
    subscriptionExpiresAt: null,
    avgRating: 4.5,
    reviewsCount: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    schedules: [{ id: "sch-1", doctorId: "11111111-1111-4111-8111-111111111111", dayOfWeek: 0, startTime: "08:00", endTime: "12:00", isException: false, exceptionDate: null, isOff: false }],
    reviews: [],
  });

  const matchWhere = (a: any, w: any) =>
    (!w.id || a.id === w.id) &&
    (w.guestPhone === undefined || a.guestPhone === w.guestPhone) &&
    (w.patientId === undefined || a.patientId === w.patientId) &&
    (!w.date?.gte || a.date >= w.date.gte) &&
    (!w.status?.in || w.status.in.includes(a.status));

  const db: any = {
    appointment: {
      findFirst: vi.fn(async ({ where, select }: any) => applySelect(s.appts.find((a) => matchWhere(a, where)) ?? null, select)),
      findUnique: vi.fn(async ({ where }: any) => s.appts.find((a) => a.id === where.id) ?? null),
      update: vi.fn(async ({ where, data, select }: any) => {
        const a = s.appts.find((x) => x.id === where.id);
        Object.assign(a, data);
        return applySelect(a, select);
      }),
    },
    doctor: {
      findMany: vi.fn(async ({ select }: any) => s.doctors.map((d) => applySelect(d, select))),
      count: vi.fn(async () => s.doctors.length),
      findUnique: vi.fn(async ({ where, select }: any) => applySelect(s.doctors.find((d) => d.id === where.id) ?? null, select)),
      findFirst: vi.fn(async ({ where, select }: any) =>
        applySelect(s.doctors.find((d) => d.id === where.id && (!where.verificationStatus || d.verificationStatus === where.verificationStatus)) ?? null, select)
      ),
      update: vi.fn(async ({ where, data }: any) => Object.assign(s.doctors.find((d) => d.id === where.id), data)),
    },
    specialty: { update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })) },
    wilaya: { update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })) },
    user: {
      findMany: vi.fn(async () => s.users.map(({ passwordHash: _p, ...u }) => u)),
      count: vi.fn(async () => s.users.length),
      findUnique: vi.fn(async ({ where }: any) => s.users.find((u) => u.id === where.id) ??
        ({ "asst-1": { id: "asst-1", role: "ASSISTANT", isActive: true }, "pat-1": { id: "pat-1", role: "PATIENT", isActive: true } } as any)[where.id] ?? null),
      findFirst: vi.fn(async ({ where }: any) => {
        const eq = String(where.email.equals).toLowerCase();
        return s.users.find((u) => u.email.toLowerCase() === eq && u.id !== where.NOT?.id) ?? null;
      }),
      update: vi.fn(async ({ where, data }: any) => ({ ...Object.assign(s.users.find((u) => u.id === where.id), data) })),
    },
    refreshToken: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hit = s.tokens.filter((t) => t.userId === where.userId && !t.revoked);
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => (s.audit.push(data), data)) },
  };
  db.$transaction = vi.fn(async (work: (tx: typeof db) => unknown) => work(db));
  return { s, db, DOCTOR, future };
});

vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
vi.mock("../src/modules/notifications/notifications.service", async (orig) => ({
  ...(await orig<typeof import("../src/modules/notifications/notifications.service")>()),
  createNotification: vi.fn(async () => undefined),
}));
vi.mock("../src/utils/password", () => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
  comparePassword: vi.fn(async (plain: string, hash: string) => hash === `hashed:${plain}`),
}));

let app: any;
beforeAll(async () => {
  const { createApp } = await import("../src/app");
  app = createApp();
});

const APPT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const PHONE = "0551234567";

beforeEach(() => {
  h.s.appts = [
    {
      id: APPT_ID,
      patientId: null,
      guestPhone: PHONE,
      guestFirstName: "سارة",
      guestLastName: "بن يوسف",
      notes: "ملاحظة طبية خاصة",
      date: h.future,
      startTime: "09:00",
      endTime: "09:07",
      status: "CONFIRMED",
      doctorId: h.DOCTOR().id,
      doctor: h.DOCTOR(),
    },
  ];
  h.s.doctors = [h.DOCTOR()];
  h.s.users = [
    { id: "admin-1", email: "admin@madbook.dz", role: "ADMIN", passwordHash: "hashed:AdminPass1!", isActive: true },
    { id: "doc-1", email: "doc@madbook.dz", role: "DOCTOR", passwordHash: "hashed:DocPass1!", isActive: true },
    { id: "doc-2", email: "taken@madbook.dz", role: "DOCTOR", passwordHash: "hashed:x", isActive: true },
  ];
  h.s.tokens = [
    { userId: "doc-1", revoked: false },
    { userId: "doc-1", revoked: false },
  ];
  h.s.audit = [];
  Object.values(h.db).forEach((m: any) => Object.values(m).forEach((fn: any) => fn.mockClear?.()));
});

const bearer = (sub: string, role: string) => `Bearer ${signAccessToken({ sub, role: role as any })}`;
const ADMIN = bearer("admin-1", "ADMIN");
const DOCTOR = bearer("doc-1", "DOCTOR");
const ASSISTANT = bearer("asst-1", "ASSISTANT");
const PATIENT = bearer("pat-1", "PATIENT");

// ---------------------------------------------------------------------------
describe("GET /api/booking/lookup — لا كشف لبيانات المرضى", () => {
  it("رقم الهاتف وحده لم يعد كافيًا (400)", async () => {
    const r = await request(app).get("/api/booking/lookup").query({ phone: PHONE });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain("سارة");
  });

  it("معرّف صحيح + هاتف خاطئ ⇒ نتيجة فارغة (لا تمييز بين الحالات)", async () => {
    const r = await request(app).get("/api/booking/lookup").query({ phone: "0559999999", appointmentId: APPT_ID });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it("هاتف صحيح + معرّف آخر ⇒ نتيجة فارغة", async () => {
    const r = await request(app).get("/api/booking/lookup").query({ phone: PHONE, appointmentId: OTHER_ID });
    expect(r.body.data).toEqual([]);
  });

  it("موعد مرتبط بحساب مريض لا يُكشف عبر المسار العام", async () => {
    h.s.appts[0].patientId = "patient-x";
    const r = await request(app).get("/api/booking/lookup").query({ phone: PHONE, appointmentId: APPT_ID });
    expect(r.body.data).toEqual([]);
  });

  it("تطابق كامل ⇒ الحقول الضرورية فقط، والهاتف مُخفى", async () => {
    const r = await request(app).get("/api/booking/lookup").query({ phone: PHONE, appointmentId: APPT_ID });
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    const a = r.body.data[0];
    expect(a.phoneMasked).toBe("05******67");
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain(PHONE);
    for (const leak of ["guestPhone", "guestFirstName", "guestLastName", "notes", "userId", "patientId", "subscriptionStatus", "سارة", "ملاحظة طبية"]) {
      expect(raw).not.toContain(leak);
    }
    expect(a.doctor.firstName).toBe("أمين");
  });

  it("معاملات إضافية مرفوضة (400)", async () => {
    const r = await request(app).get("/api/booking/lookup").query({ phone: PHONE, appointmentId: APPT_ID, patientId: "x" });
    expect(r.status).toBe(400);
  });

  it("تجربة أرقام كثيرة تُوقف بحدّ المحاولات (429)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const phone = `05500000${String(i).padStart(2, "0")}`;
      const r = await request(app).get("/api/booking/lookup").set("X-Forwarded-For", "203.0.113.77, 10.0.0.1").query({ phone, appointmentId: APPT_ID });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
  });
});

describe("PATCH /api/booking/:id/cancel — نفس الرد لكل عدم تطابق", () => {
  it("هاتف خاطئ ⇒ 404 موحّد (لا 403 يؤكد وجود الموعد)", async () => {
    const r = await request(app).patch(`/api/booking/${APPT_ID}/cancel`).set("X-Forwarded-For", "203.0.113.20, 10.0.0.1").send({ phone: "0559999999" });
    expect(r.status).toBe(404);
    expect(h.s.appts[0].status).toBe("CONFIRMED");
  });

  it("تطابق ⇒ يُلغى ويُرجع حقولًا دنيا بلا هاتف كامل ولا اسم", async () => {
    const r = await request(app).patch(`/api/booking/${APPT_ID}/cancel`).set("X-Forwarded-For", "203.0.113.21, 10.0.0.1").send({ phone: PHONE });
    expect(r.status).toBe(200);
    expect(h.s.appts[0].status).toBe("CANCELLED");
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain(PHONE);
    expect(raw).not.toContain("سارة");
    expect(raw).not.toContain("userId");
  });

  it("حقول زائدة في الجسم مرفوضة (400)", async () => {
    const r = await request(app).patch(`/api/booking/${APPT_ID}/cancel`).set("X-Forwarded-For", "203.0.113.22, 10.0.0.1").send({ phone: PHONE, status: "COMPLETED" });
    expect(r.status).toBe(400);
    expect(h.s.appts[0].status).toBe("CONFIRMED");
  });
});

// ---------------------------------------------------------------------------
describe("مسارات PATCH للإدارة — صلاحيات", () => {
  const DOC_ID = "11111111-1111-4111-8111-111111111111";
  it.each([
    ["بلا توكن", undefined, 401],
    ["طبيب", DOCTOR, 403],
    ["مساعد", ASSISTANT, 403],
    ["مريض", PATIENT, 403],
  ])("%s ⇒ %i", async (_label, token, code) => {
    const req = request(app).patch(`/api/admin/doctors/${DOC_ID}`);
    if (token) req.set("Authorization", token);
    const r = await req.send({ subscriptionStatus: "ACTIVE" });
    expect(r.status).toBe(code);
    expect(h.db.doctor.update).not.toHaveBeenCalled();
  });

  it("الإدارة ⇒ 200", async () => {
    const r = await request(app).patch(`/api/admin/doctors/${DOC_ID}`).set("Authorization", ADMIN).send({ subscriptionStatus: "ACTIVE" });
    expect(r.status).toBe(200);
  });
});

describe("مسارات PATCH للإدارة — تحقق المدخلات", () => {
  const DOC_ID = "11111111-1111-4111-8111-111111111111";
  const SP_ID = "44444444-4444-4444-8444-444444444444";
  const W_ID = "55555555-5555-4555-8555-555555555555";
  const patch = (url: string, body: any) => request(app).patch(url).set("Authorization", ADMIN).send(body);

  it("طبيب: حقل مسموح يُمرَّر كما هو فقط", async () => {
    const r = await patch(`/api/admin/doctors/${DOC_ID}`, { subscriptionStatus: "EXPIRED" });
    expect(r.status).toBe(200);
    expect(h.db.doctor.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: DOC_ID },
      data: { subscriptionStatus: "EXPIRED" },
    }));
  });

  it.each([
    ["قيمة enum خاطئة", { subscriptionStatus: "FREE_FOREVER" }],
    ["حقل غير متوقَّع", { subscriptionStatus: "ACTIVE", verificationStatus: "VERIFIED" }],
    ["محاولة كتابة userId", { userId: "attacker" }],
    ["كتابة متداخلة على الحساب", { user: { update: { role: "ADMIN" } } }],
    ["جسم فارغ", {}],
  ])("طبيب: %s ⇒ 400 دون أي كتابة", async (_l, body) => {
    const r = await patch(`/api/admin/doctors/${DOC_ID}`, body);
    expect(r.status).toBe(400);
    expect(h.db.doctor.update).not.toHaveBeenCalled();
    expect(JSON.stringify(r.body)).not.toMatch(/prisma|stack|at \w+ \(/i);
  });

  it("معرّف غير صالح ⇒ 400", async () => {
    const r = await patch(`/api/admin/doctors/not-a-uuid`, { subscriptionStatus: "ACTIVE" });
    expect(r.status).toBe(400);
  });

  it("تخصص: صحيح ⇒ 200، حقل زائد ⇒ 400، اسم قصير ⇒ 400", async () => {
    expect((await patch(`/api/admin/specialties/${SP_ID}`, { nameAr: "طب الأطفال" })).status).toBe(200);
    expect((await patch(`/api/admin/specialties/${SP_ID}`, { nameAr: "طب الأطفال", doctors: { deleteMany: {} } })).status).toBe(400);
    expect((await patch(`/api/admin/specialties/${SP_ID}`, { nameAr: "ط" })).status).toBe(400);
    expect(h.db.specialty.update).toHaveBeenCalledTimes(1);
  });

  it("ولاية: صحيح ⇒ 200، حقل زائد ⇒ 400، نوع خاطئ ⇒ 400", async () => {
    expect((await patch(`/api/admin/wilayas/${W_ID}`, { nameAr: "ميلة" })).status).toBe(200);
    expect((await patch(`/api/admin/wilayas/${W_ID}`, { nameAr: "ميلة", id: "x" })).status).toBe(400);
    expect((await patch(`/api/admin/wilayas/${W_ID}`, { code: 43 })).status).toBe(400);
    expect(h.db.wilaya.update).toHaveBeenCalledTimes(1);
  });

  it("توثيق الطبيب: حالة غير معروفة أو حقل زائد ⇒ 400", async () => {
    expect((await patch(`/api/admin/doctors/${DOC_ID}/verify`, { status: "SUPER" })).status).toBe(400);
    expect((await patch(`/api/admin/doctors/${DOC_ID}/verify`, { status: "VERIFIED", subscriptionStatus: "ACTIVE" })).status).toBe(400);
  });

  it("تفعيل/تعطيل مستخدم: جسم غير فارغ ⇒ 400، والرد لا يحمل تجزئة كلمة المرور", async () => {
    expect((await patch(`/api/admin/users/doc-1/deactivate`, {})).status).toBe(400); // معرّف ليس UUID
    h.s.users.push({ id: "66666666-6666-4666-8666-666666666666", email: "u@x.dz", role: "DOCTOR", passwordHash: "hashed:secret", isActive: true });
    const url = `/api/admin/users/66666666-6666-4666-8666-666666666666/deactivate`;
    expect((await patch(url, { isActive: true, role: "ADMIN" })).status).toBe(400);
    const ok = await patch(url, {});
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain("passwordHash");
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/doctors — الرد العام", () => {
  const HIDDEN = ["userId", "subscriptionStatus", "subscriptionExpiresAt", "createdAt", "updatedAt", "doctor-user-secret-id"];

  it("القائمة لا تحتوي userId ولا حقولًا داخلية", async () => {
    const r = await request(app).get("/api/doctors");
    expect(r.status).toBe(200);
    const item = r.body.data.items[0];
    expect(item).not.toHaveProperty("userId");
    const raw = JSON.stringify(r.body);
    for (const k of HIDDEN) expect(raw).not.toContain(k);
    // ما تحتاجه واجهة المرضى ما زال موجودًا
    expect(item).toMatchObject({ id: expect.any(String), firstName: "أمين", specialty: { nameAr: "طب عام" }, city: { nameAr: "ميلة" }, avgRating: 4.5 });
  });

  it("صفحة الطبيب لا تحتوي userId ولا حقولًا داخلية", async () => {
    const r = await request(app).get(`/api/doctors/${h.DOCTOR().id}`);
    expect(r.status).toBe(200);
    expect(r.body.data).not.toHaveProperty("userId");
    const raw = JSON.stringify(r.body);
    for (const k of HIDDEN) expect(raw).not.toContain(k);
    expect(r.body.data.schedules[0]).toMatchObject({ startTime: "08:00", endTime: "12:00" });
  });

  it("البحث بالموقع (lat/lng) كذلك بلا userId", async () => {
    const r = await request(app).get("/api/doctors").query({ lat: 36.45, lng: 6.26 });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("userId");
  });
});

// ---------------------------------------------------------------------------
describe("PATCH /api/auth/account — تغيير البريد", () => {
  const send = (token: string, body: any, ip: string) =>
    request(app).patch("/api/auth/account").set("Authorization", token).set("X-Forwarded-For", `${ip}, 10.0.0.1`).send(body);

  it("بلا كلمة المرور الحالية ⇒ 400", async () => {
    const r = await send(DOCTOR, { email: "new@madbook.dz" }, "198.51.100.1");
    expect(r.status).toBe(400);
    expect(h.s.users[1].email).toBe("doc@madbook.dz");
  });

  it("كلمة مرور خاطئة ⇒ 401 ولا تغيير", async () => {
    const r = await send(DOCTOR, { currentPassword: "wrong", email: "new@madbook.dz" }, "198.51.100.2");
    expect(r.status).toBe(401);
    expect(h.s.users[1].email).toBe("doc@madbook.dz");
  });

  it("حساب الإدارة ⇒ 403 حتى بكلمة مرور صحيحة", async () => {
    const r = await send(ADMIN, { currentPassword: "AdminPass1!", email: "evil@madbook.dz" }, "198.51.100.3");
    expect(r.status).toBe(403);
    expect(h.s.users[0].email).toBe("admin@madbook.dz");
  });

  it("بريد مستخدم مسبقًا (بحالة أحرف مختلفة) ⇒ 409", async () => {
    const r = await send(DOCTOR, { currentPassword: "DocPass1!", email: "TAKEN@madbook.dz" }, "198.51.100.4");
    expect(r.status).toBe(409);
  });

  it("حقل غير متوقَّع (مثل role) ⇒ 400", async () => {
    const r = await send(DOCTOR, { currentPassword: "DocPass1!", role: "ADMIN" }, "198.51.100.5");
    expect(r.status).toBe(400);
  });

  it("تغيير صحيح ⇒ 200، تُبطل كل الجلسات، والرد بلا تجزئة كلمة المرور", async () => {
    const r = await send(DOCTOR, { currentPassword: "DocPass1!", email: "new@madbook.dz" }, "198.51.100.6");
    expect(r.status).toBe(200);
    expect(h.s.users[1].email).toBe("new@madbook.dz");
    expect(h.s.tokens.every((t) => t.revoked)).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("passwordHash");
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/doctors/:id — الموثَّق فقط", () => {
  it.each(["PENDING", "REJECTED"])("طبيب %s ⇒ 404 مثل غير الموجود", async (status) => {
    h.s.doctors[0].verificationStatus = status;
    const r = await request(app).get(`/api/doctors/${h.DOCTOR().id}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain("أمين");
  });

  it("معرّف غير موجود ⇒ نفس 404", async () => {
    const r = await request(app).get(`/api/doctors/99999999-9999-4999-8999-999999999999`);
    expect(r.status).toBe(404);
  });

  it("الاستعلام نفسه يشترط VERIFIED (لا تصفية بعد الجلب)", async () => {
    await request(app).get(`/api/doctors/${h.DOCTOR().id}`);
    expect(h.db.doctor.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: h.DOCTOR().id, verificationStatus: "VERIFIED", user: { isActive: true }, AND: expect.any(Array) }) }));
    const select = (h.db.doctor.findFirst.mock.calls[0] as any[])[0].select;
    expect(select).not.toHaveProperty("userId");
    expect(select).not.toHaveProperty("subscriptionStatus");
  });
});

describe("GET /api/admin/users و /api/admin/doctors — معاملات صارمة", () => {
  const get = (url: string, query: Record<string, unknown>) => request(app).get(url).set("Authorization", ADMIN).query(query);

  it.each([
    ["/api/admin/users", { role: "DOCTOR", q: "doc", page: 2, pageSize: 50 }],
    ["/api/admin/users", {}],
    ["/api/admin/users", { q: "" }],
    ["/api/admin/doctors", { verificationStatus: "PENDING", q: "أمين", page: 1, pageSize: 10 }],
    ["/api/admin/doctors", {}],
  ])("%s بمعاملات صحيحة ⇒ 200", async (url, q) => {
    const r = await get(url, q);
    expect(r.status).toBe(200);
  });

  it("الحدود تُمرَّر كأرقام إلى الخدمة", async () => {
    const r = await get("/api/admin/users", { page: 3, pageSize: 5 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ page: 3, pageSize: 5 });
  });

  it.each([
    ["/api/admin/users", { pageSize: 51 }],
    ["/api/admin/users", { pageSize: 0 }],
    ["/api/admin/users", { page: 0 }],
    ["/api/admin/users", { page: 1001 }],
    ["/api/admin/users", { page: "abc" }],
    ["/api/admin/users", { page: 1.5 }],
    ["/api/admin/users", { role: "SUPERADMIN" }],
    ["/api/admin/users", { q: "x".repeat(101) }],
    ["/api/admin/users", { sort: "passwordHash" }],
    ["/api/admin/doctors", { verificationStatus: "APPROVED" }],
    ["/api/admin/doctors", { pageSize: 1000 }],
    ["/api/admin/doctors", { userId: "x" }],
  ])("%s %j ⇒ 400", async (url, q) => {
    const r = await get(url, q);
    expect(r.status).toBe(400);
  });

  it("غير الإدارة ⇒ 403 حتى بمعاملات صحيحة", async () => {
    const r = await request(app).get("/api/admin/users").set("Authorization", DOCTOR);
    expect(r.status).toBe(403);
  });
});
