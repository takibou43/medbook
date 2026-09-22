/**
 * حساب المريض وإشعاراته عبر HTTP الحقيقي (Express + Zod + JWT + bcrypt + الكوكي)،
 * مع استبدال Prisma فقط بمخزن في الذاكرة يطبّق القيد الفريد على البريد والـendpoint.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { signAccessToken } from "../src/utils/jwt";

const h = vi.hoisted(() => {
  const s = {
    users: [] as any[],
    patients: [] as any[],
    tokens: [] as any[],
    subs: [] as any[],
    appts: [] as any[],
    seq: 0,
  };
  const id = (p: string) => `${p}-${++s.seq}`;
  const withPatient = (u: any) => ({
    id: u.id,
    email: u.email,
    phone: u.phone,
    role: u.role,
    createdAt: u.createdAt,
    patient: (() => {
      const p = s.patients.find((x) => x.userId === u.id);
      return p ? { id: p.id, firstName: p.firstName, lastName: p.lastName } : null;
    })(),
  });
  const emailEq = (a: string, cond: any) =>
    cond.mode === "insensitive" ? a.toLowerCase() === String(cond.equals).toLowerCase() : a === cond.equals;

  const db = {
    user: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const match = (u: any) => {
          if (where.OR) return where.OR.some((c: any) => (c.email ? emailEq(u.email, c.email) : u.phone === c.phone));
          return emailEq(u.email, where.email) && (!where.role || u.role === where.role);
        };
        const u = s.users.find(match);
        if (!u) return null;
        return select?.passwordHash ? { id: u.id, role: u.role, isActive: u.isActive, passwordHash: u.passwordHash } : { id: u.id };
      }),
      create: vi.fn(async ({ data }: any) => {
        if (s.users.some((u) => u.email === data.email)) {
          const { Prisma } = await import("@prisma/client");
          throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
        }
        const u = { id: id("user"), email: data.email, phone: data.phone, passwordHash: data.passwordHash, role: data.role, isActive: true, createdAt: new Date() };
        s.users.push(u);
        s.patients.push({ id: id("patient"), userId: u.id, ...data.patient.create });
        return withPatient(u);
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const u = s.users.find((x) => x.id === where.id);
        if (!u) return null;
        return { ...withPatient(u), isActive: u.isActive };
      }),
    },
    patient: {
      findUnique: vi.fn(async ({ where }: any) => s.patients.find((p) => p.userId === where.userId) ?? null),
    },
    refreshToken: {
      create: vi.fn(async ({ data }: any) => (s.tokens.push({ id: id("rt"), revoked: false, ...data }), {})),
      findFirst: vi.fn(async ({ where }: any) => s.tokens.find((t) => t.userId === where.userId && t.tokenHash === where.tokenHash && !t.revoked) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(s.tokens.find((t) => t.id === where.id), data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hit = s.tokens.filter((t) => t.tokenHash === where.tokenHash);
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      }),
    },
    pushSubscription: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const ex = s.subs.find((x) => x.endpoint === where.endpoint);
        if (ex) return Object.assign(ex, update);
        const row = { id: id("sub"), ...create };
        s.subs.push(row);
        return row;
      }),
      count: vi.fn(async ({ where }: any) => s.subs.filter((x) => x.userId === where.userId).length),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = s.subs.length;
        s.subs = s.subs.filter((x) => !(x.endpoint === where.endpoint && x.userId === where.userId));
        return { count: before - s.subs.length };
      }),
      findMany: vi.fn(async () => []),
    },
    appointment: {
      findMany: vi.fn(async ({ where }: any) => s.appts.filter((a) => a.patientId === where.patientId)),
    },
    // لا حظر في هذا الملف (اختبارات الحظر الحقيقية في tests/integration/patientBlocks.integration.test.ts).
    patientBlock: {
      findUnique: vi.fn(async () => null),
    },
  };
  const createGuest = vi.fn(async (_input: any, patientId: string | null) => ({ id: "appt-1", patientId }));
  return { s, db, createGuest };
});

vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
vi.mock("../src/modules/booking/booking.service", async (orig) => ({
  ...(await orig<typeof import("../src/modules/booking/booking.service")>()),
  createGuestAppointment: h.createGuest,
}));

let app: any;
beforeAll(async () => {
  const { createApp } = await import("../src/app");
  app = createApp();
});

beforeEach(() => {
  h.s.users = [];
  h.s.patients = [];
  h.s.tokens = [];
  h.s.subs = [];
  h.s.appts = [];
  h.createGuest.mockClear();
});

const REGISTER = { email: "  Sara.Patient@Example.COM ", password: "Secret123!", name: "سارة بن يوسف", phone: "0551234567" };
const SUB = (n: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
});

async function registerAndGetToken(body = REGISTER) {
  const r = await request(app).post("/api/patient/auth/register").send(body);
  return { res: r, token: `Bearer ${r.body.data?.accessToken}`, cookie: r.headers["set-cookie"] as unknown as string[] };
}

/** مريض جاهز في المخزن + توكن موقّع مباشرة (دون المرور بمحدِّد محاولات تسجيل الدخول). */
function seedPatient(n: number) {
  const userId = `seed-user-${n}`;
  h.s.users.push({ id: userId, email: `p${n}@x.dz`, phone: null, passwordHash: "x", role: "PATIENT", isActive: true, createdAt: new Date() });
  h.s.patients.push({ id: `seed-patient-${n}`, userId, firstName: `P${n}`, lastName: "T" });
  return { userId, patientId: `seed-patient-${n}`, token: `Bearer ${signAccessToken({ sub: userId, role: "PATIENT" as any })}` };
}
const doctorToken = `Bearer ${signAccessToken({ sub: "doctor-user", role: "DOCTOR" as any })}`;

describe("1) التسجيل", () => {
  it("ينشئ الحساب ببريد مُطبَّع، لا يعيد passwordHash، ويضع كوكي تجديد httpOnly خاصًا بالمريض", async () => {
    const { res } = await registerAndGetToken();
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe("sara.patient@example.com");
    expect(res.body.data.user.patient).toMatchObject({ firstName: "سارة", lastName: "بن يوسف" });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const cookie = (res.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cookie).toMatch(/medbook_patient_refresh=/);
    expect(cookie).toMatch(/Path=\/api\/patient\/auth/);
    expect(cookie).toMatch(/HttpOnly/);
    // كلمة المرور محفوظة مُجزّأة فقط
    expect(h.s.users[0].passwordHash).not.toBe(REGISTER.password);
    expect(h.s.users[0].passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("2) يمنع البريد المكرر حتى باختلاف حالة الأحرف والمسافات (409)", async () => {
    await registerAndGetToken();
    const r = await request(app).post("/api/patient/auth/register").send({ ...REGISTER, email: "SARA.PATIENT@example.com", phone: undefined });
    expect(r.status).toBe(409);
    expect(h.s.users).toHaveLength(1);
  });

  it("يرفض بريدًا غير صالح وكلمة مرور قصيرة (400) دون إنشاء أي حساب", async () => {
    const a = await request(app).post("/api/patient/auth/register").send({ ...REGISTER, email: "not-an-email" });
    const b = await request(app).post("/api/patient/auth/register").send({ ...REGISTER, email: "b@x.dz", password: "123" });
    expect([a.status, b.status]).toEqual([400, 400]);
    expect(h.s.users).toHaveLength(0);
  });
});

describe("3+4) تسجيل الدخول", () => {
  it("دخول صحيح ببريد بأحرف كبيرة => 200 + توكن + كوكي، بلا passwordHash", async () => {
    await registerAndGetToken();
    const r = await request(app).post("/api/patient/auth/login").send({ email: "SARA.patient@EXAMPLE.com", password: REGISTER.password });
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe("sara.patient@example.com");
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash/);
  });

  it("كلمة مرور خاطئة وبريد غير موجود => نفس الرد 401 (لا تعداد للحسابات)", async () => {
    await registerAndGetToken();
    const wrong = await request(app).post("/api/patient/auth/login").send({ email: REGISTER.email, password: "WrongPass999" });
    const unknown = await request(app).post("/api/patient/auth/login").send({ email: "nobody@x.dz", password: "WrongPass999" });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("حساب طبيب لا يدخل من مسار المرضى (401)", async () => {
    const { hashPassword } = await import("../src/utils/password");
    h.s.users.push({ id: "doc-1", email: "doc@x.dz", passwordHash: await hashPassword("DoctorPass1"), role: "DOCTOR", isActive: true, createdAt: new Date() });
    const r = await request(app).post("/api/patient/auth/login").send({ email: "doc@x.dz", password: "DoctorPass1" });
    expect(r.status).toBe(401);
  });
});

describe("5+6) الحساب الحالي والخروج", () => {
  it("/me يعيد المريض الحالي فقط؛ بلا توكن 401؛ الطبيب 403", async () => {
    const { token } = await registerAndGetToken();
    const me = await request(app).get("/api/patient/auth/me").set("Authorization", token);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ email: "sara.patient@example.com", role: "PATIENT" });
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);
    expect((await request(app).get("/api/patient/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/patient/auth/me").set("Authorization", doctorToken)).status).toBe(403);
  });

  it("refresh بالكوكي يدوّر الجلسة، و logout يبطلها فيفشل أي refresh بعده", async () => {
    const { cookie } = await registerAndGetToken();
    const r1 = await request(app).post("/api/patient/auth/refresh").set("Cookie", cookie);
    expect(r1.status).toBe(200);
    const rotated = r1.headers["set-cookie"] as unknown as string[];
    // التوكن القديم أُبطل بالتدوير
    expect((await request(app).post("/api/patient/auth/refresh").set("Cookie", cookie)).status).toBe(401);

    const out = await request(app).post("/api/patient/auth/logout").set("Cookie", rotated);
    expect(out.status).toBe(200);
    expect((out.headers["set-cookie"] as unknown as string[]).join(";")).toMatch(/medbook_patient_refresh=;/);
    expect((await request(app).post("/api/patient/auth/refresh").set("Cookie", rotated)).status).toBe(401);
  });
});

describe("8-10) اشتراكات Push", () => {
  it("حفظ الاشتراك مربوطًا بالمريض من الجلسة (يُتجاهل أي userId في الجسم)", async () => {
    const a = seedPatient(1);
    const r = await request(app)
      .post("/api/patient/notifications/subscribe")
      .set("Authorization", a.token)
      .send({ ...SUB("phone"), userId: "someone-else" });
    expect(r.status).toBe(201);
    expect(h.s.subs).toHaveLength(1);
    expect(h.s.subs[0]).toMatchObject({ userId: a.userId, endpoint: SUB("phone").endpoint });
  });

  it("أكثر من جهاز للمريض نفسه (هاتف + حاسوب + لوحي) وإعادة نفس الجهاز لا تكرره", async () => {
    const a = seedPatient(1);
    for (const d of ["phone", "laptop", "tablet", "phone"]) {
      await request(app).post("/api/patient/notifications/subscribe").set("Authorization", a.token).send(SUB(d)).expect(201);
    }
    expect(h.s.subs.filter((x) => x.userId === a.userId)).toHaveLength(3);
    const st = await request(app).get("/api/patient/notifications/status").set("Authorization", a.token);
    expect(st.body.data.devices).toBe(3);
  });

  it("حذف الاشتراك: صاحبه فقط؛ مريض آخر لا يستطيع حذف اشتراك غيره", async () => {
    const a = seedPatient(1);
    const b = seedPatient(2);
    await request(app).post("/api/patient/notifications/subscribe").set("Authorization", a.token).send(SUB("phone"));
    const byB = await request(app).delete("/api/patient/notifications/subscribe").set("Authorization", b.token).send({ endpoint: SUB("phone").endpoint });
    expect(byB.body.data.removed).toBe(0);
    expect(h.s.subs).toHaveLength(1);
    const byA = await request(app).delete("/api/patient/notifications/subscribe").set("Authorization", a.token).send({ endpoint: SUB("phone").endpoint });
    expect(byA.body.data.removed).toBe(1);
    expect(h.s.subs).toHaveLength(0);
  });

  it("اشتراك غير صالح (http، مفاتيح ناقصة) => 400؛ بلا توكن 401؛ الطبيب 403", async () => {
    const a = seedPatient(1);
    const bad1 = await request(app).post("/api/patient/notifications/subscribe").set("Authorization", a.token).send({ ...SUB("x"), endpoint: "http://insecure.example/x" });
    const bad2 = await request(app).post("/api/patient/notifications/subscribe").set("Authorization", a.token).send({ endpoint: SUB("x").endpoint, keys: { p256dh: "" } });
    expect([bad1.status, bad2.status]).toEqual([400, 400]);
    expect((await request(app).post("/api/patient/notifications/subscribe").send(SUB("x"))).status).toBe(401);
    expect((await request(app).post("/api/patient/notifications/subscribe").set("Authorization", doctorToken).send(SUB("x"))).status).toBe(403);
    expect(h.s.subs).toHaveLength(0);
  });

  it("الإشعار التجريبي محمي: بلا توكن 401، وبلا مفاتيح VAPID على الخادم 503 (لا إرسال)", async () => {
    const a = seedPatient(1);
    expect((await request(app).post("/api/patient/notifications/test")).status).toBe(401);
    const r = await request(app).post("/api/patient/notifications/test").set("Authorization", a.token);
    expect(r.status).toBe(503);
  });
});

describe("20) عدم كشف بيانات مريض آخر", () => {
  it("قائمة «مواعيدي» مقيّدة بـpatientId من الجلسة فقط", async () => {
    const a = seedPatient(1);
    const b = seedPatient(2);
    h.s.appts.push({ id: "A1", patientId: a.patientId }, { id: "B1", patientId: b.patientId });
    const r = await request(app).get(`/api/patient/account/appointments?patientId=${b.patientId}`).set("Authorization", a.token);
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: any) => x.id)).toEqual(["A1"]);
    expect(h.db.appointment.findMany.mock.calls.at(-1)![0].where).toEqual({ patientId: a.patientId });
  });

  it("اختيار حقول الطبيب صريح: لا userId ولا رسوم ولا حالة اشتراك في الاستعلام", async () => {
    const a = seedPatient(1);
    await request(app).get("/api/patient/account/appointments").set("Authorization", a.token);
    const sel = JSON.stringify(h.db.appointment.findMany.mock.calls.at(-1)![0].select);
    expect(sel).not.toMatch(/userId|consultationFee|subscription|notes|guestPhone/);
  });
});

describe("7) الحجز يتطلب حساب مريض مسجّل الدخول", () => {
  const BOOK = {
    firstName: "سارة",
    lastName: "بن يوسف",
    phone: "0551234567",
    wilayaId: "11111111-1111-4111-8111-111111111111",
    specialtyId: "22222222-2222-4222-8222-222222222222",
    doctorId: "33333333-3333-4333-8333-333333333333",
  };

  it("بلا تسجيل دخول: 401 ولا يُنشأ أي موعد (حتى باستدعاء الـAPI مباشرة)", async () => {
    const r = await request(app).post("/api/booking").send(BOOK);
    expect(r.status).toBe(401);
    expect(h.createGuest).not.toHaveBeenCalled();
  });

  it("بلا تسجيل دخول مع patientId لمريض موجود في الجسم: 401 ولا حجز", async () => {
    seedPatient(2);
    const r = await request(app).post("/api/booking").send({ ...BOOK, patientId: "seed-patient-2" });
    expect(r.status).toBe(401);
    expect(h.createGuest).not.toHaveBeenCalled();
  });

  it("مريض مسجَّل الدخول: الموعد يُربط بحسابه (patientId من الجلسة، لا من الجسم)", async () => {
    const a = seedPatient(1);
    seedPatient(2);
    const r = await request(app).post("/api/booking").set("Authorization", a.token).send({ ...BOOK, patientId: "seed-patient-2" });
    expect(r.status).toBe(201);
    expect(h.createGuest.mock.calls[0][1]).toBe(a.patientId);
    expect(h.createGuest.mock.calls[0][0]).not.toHaveProperty("patientId");
  });

  it("توكن غير صالح: 401 ولا حجز", async () => {
    const r = await request(app).post("/api/booking").set("Authorization", "Bearer broken.token.value").send(BOOK);
    expect(r.status).toBe(401);
    expect(h.createGuest).not.toHaveBeenCalled();
  });

  it("توكن منتهي الصلاحية: 401 ولا حجز", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const { env } = await import("../src/config/env");
    const a = seedPatient(1);
    const expired = jwt.sign({ sub: a.userId, role: "PATIENT", exp: Math.floor(Date.now() / 1000) - 60 }, env.jwtSecret);
    const r = await request(app).post("/api/booking").set("Authorization", `Bearer ${expired}`).send(BOOK);
    expect(r.status).toBe(401);
    expect(h.createGuest).not.toHaveBeenCalled();
  });

  it("حساب غير مريض (طبيب) لا يستطيع إنشاء حجز: 403", async () => {
    const r = await request(app).post("/api/booking").set("Authorization", doctorToken).send(BOOK);
    expect(r.status).toBe(403);
    expect(h.createGuest).not.toHaveBeenCalled();
  });

  it("توكن مريض بلا ملف مريض مرتبط: 403 ولا حجز", async () => {
    const orphan = `Bearer ${signAccessToken({ sub: "user-without-patient", role: "PATIENT" as any })}`;
    const r = await request(app).post("/api/booking").set("Authorization", orphan).send(BOOK);
    expect(r.status).toBe(403);
    expect(h.createGuest).not.toHaveBeenCalled();
  });

  it("تسجيل حساب ثم الحجز بتوكنه مباشرة: 201 ومربوط بالحساب الجديد", async () => {
    const reg = await request(app)
      .post("/api/patient/auth/register")
      .send({ name: "سارة بن يوسف", email: "new.booker@x.dz", password: "password123" });
    expect(reg.status).toBe(201);
    const r = await request(app).post("/api/booking").set("Authorization", `Bearer ${reg.body.data.accessToken}`).send(BOOK);
    expect(r.status).toBe(201);
    expect(h.createGuest.mock.calls[0][1]).toBeTruthy();
    expect(h.createGuest.mock.calls[0][1]).not.toBe("seed-patient-1");
  });

  it("تسجيل ← خروج ← دخول من جديد ← حجز: 201 ومربوط بنفس الحساب", async () => {
    const { res, cookie } = await registerAndGetToken();
    expect(res.status).toBe(201);
    expect((await request(app).post("/api/patient/auth/logout").set("Cookie", cookie)).status).toBe(200);
    const login = await request(app).post("/api/patient/auth/login").send({ email: REGISTER.email, password: REGISTER.password });
    expect(login.status).toBe(200);
    const me = await request(app).get("/api/patient/auth/me").set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    const r = await request(app).post("/api/booking").set("Authorization", `Bearer ${login.body.data.accessToken}`).send(BOOK);
    expect(r.status).toBe(201);
    const patientId = h.createGuest.mock.calls[0][1];
    expect(h.s.patients.find((p: any) => p.id === patientId)?.userId).toBe(me.body.data.id);
  });
});

describe("المسار الداخلي للتذكيرات", () => {
  it("معطّل (404) ما لم يُضبط REMINDER_CRON_SECRET — لا وضع مفتوح افتراضيًا", async () => {
    const r = await request(app).post("/api/internal/reminders/run");
    expect(r.status).toBe(404);
  });
});
