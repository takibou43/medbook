/**
 * حساب واحد بملفين (مريض + طبيب) على PostgreSQL حقيقي عبر HTTP:
 *  - طبيب يفعّل ملف مريض ويحجز موعدًا؛ لا يحجز عند نفسه.
 *  - مريض يقدّم طلب طبيب (PENDING) ويبقى استخدامه كمريض متاحًا قبل الاعتماد وبعده.
 *  - الدخول للواجهتين، تجديد الجلسة، الانتقال بين الواجهتين، تسجيل الخروج (واجهة واحدة / الواجهتان).
 *  - لا صلاحيات غير مصرح بها (سياقات مرفوضة، أدوار أخرى، طلبات متزامنة بلا تكرار).
 *  - التسجيل ببريد/هاتف موجود لا يربط ولا يغيّر كلمة المرور.
 *  - بقاء الدور الأصلي والاشتراك والتوثيق والمواعيد السابقة كما هي.
 * تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_dual_test?schema=public" npx vitest run dualProfile
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}

const PASSWORD = "Secret123!";

describe.skipIf(!TEST_URL)("حساب بملفين مريض + طبيب (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let sign: (p: { sub: string; role: any }) => string;
  const tag = `dp${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  let seq = 0;
  let adminToken = "";
  let otherDoctorId = "";
  let otherDoctorUserId = "";

  /** كوكيات الجلسة تُدار يدويًا (مسار كل كوكي كما في الخادم) لفحص الفصل بين الواجهتين. */
  type Jar = Record<string, string>;
  const COOKIE_PATHS: Record<string, string> = { medbook_refresh: "/api/auth", medbook_patient_refresh: "/api/patient/auth" };
  const absorb = (jar: Jar, r: Response) => {
    for (const line of r.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) delete jar[name];
      else jar[name] = value;
    }
  };
  const cookieFor = (jar: Jar, url: string) =>
    Object.entries(jar).filter(([n]) => url.startsWith(COOKIE_PATHS[n] ?? "/")).map(([n, v]) => `${n}=${v}`).join("; ");

  const call = async (method: string, url: string, body?: unknown, token?: string, jar?: Jar) => {
    const r = await fetch(base + url, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(jar ? { cookie: cookieFor(jar, url) } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (jar) absorb(jar, r);
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined, details: j?.details, raw: j };
  };

  const uniq = () => ++seq;
  const phoneOf = (n: number) => `06${String(Date.now() + n * 7919).slice(-8)}`;

  /** طبيب حقيقي عبر التسجيل (bcrypt + JWT)، ثم يُوثَّق ويُفعَّل اشتراكه مباشرة في القاعدة (الإدارة). */
  async function registerDoctor(opts: { verified?: boolean } = {}) {
    const n = uniq();
    const email = `${tag}-d${n}@test.local`;
    const phone = phoneOf(n);
    const reg = await call("POST", "/api/auth/register/doctor", {
      email, phone, password: PASSWORD, firstName: "طبيب", lastName: `${tag}${n}`,
      specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
    });
    expect(reg.status).toBe(201);
    const userId = reg.data.user.id as string;
    ids.users.push(userId);
    const doctor = await db.doctor.findUniqueOrThrow({ where: { userId } });
    ids.doctors.push(doctor.id);
    if (opts.verified) {
      await db.doctor.update({ where: { id: doctor.id }, data: { verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE" } });
    }
    return { userId, doctorId: doctor.id, email, phone };
  }

  async function registerPatient() {
    const n = uniq();
    const email = `${tag}-p${n}@test.local`;
    const phone = phoneOf(n + 500);
    const reg = await call("POST", "/api/patient/auth/register", { email, password: PASSWORD, name: `مريض ${n}`, phone });
    expect(reg.status).toBe(201);
    ids.users.push(reg.data.user.id);
    return { userId: reg.data.user.id as string, patientId: reg.data.user.patient.id as string, email, phone, token: reg.data.accessToken as string };
  }

  const doctorPortalLogin = (email: string, jar: Jar) => call("POST", "/api/auth/login", { email, password: PASSWORD }, undefined, jar);
  const patientPortalLogin = (email: string, jar: Jar) => call("POST", "/api/patient/auth/login", { email, password: PASSWORD }, undefined, jar);

  const doctorForm = () => ({
    password: PASSWORD, firstName: "طبيب", lastName: "مقدّم", specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city, yearsExperience: 3,
  });
  const book = (token: string, doctorId: string, phone = "0551234567") =>
    call("POST", "/api/booking", { firstName: "سارة", lastName: "بن يوسف", phone, wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId }, token);

  beforeEach(async () => {
    // Each scenario has its own auth budget; keep the real production limiter enabled.
    const { authLimiter } = await import("../../src/middleware/rateLimiter");
    for (const address of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) authLimiter.resetKey(address);
  });

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    process.env.REMINDERS_ENABLED = "false";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });

    const admin = await db.user.create({ data: { email: `${tag}-admin@test.local`, passwordHash: "x", role: "ADMIN" } });
    ids.users.push(admin.id);
    adminToken = sign({ sub: admin.id, role: "ADMIN" });

    // طبيب آخر موثّق بدوام مفتوح: هدف الحجز.
    const u = await db.user.create({ data: { email: `${tag}-other@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "آخر", lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 15, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, dow) => ({ dayOfWeek: dow, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    otherDoctorId = d.id;
    otherDoctorUserId = u.id;

    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    const patientIds = (await db.patient.findMany({ where: { userId: { in: ids.users } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.smsLog.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointment.deleteMany({ where: { OR: [{ doctorId: { in: ids.doctors } }, { patientId: { in: patientIds } }] } });
    await db.doctorReferral.deleteMany({ where: { OR: [{ referrerDoctorId: { in: ids.doctors } }, { referredDoctorId: { in: ids.doctors } }] } });
    await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: ids.doctors } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: ids.users } } });
    await db.user.deleteMany({ where: { id: { in: ids.users } } });
    await db.specialty.deleteMany({ where: { id: ids.specialty } });
    await db.city.deleteMany({ where: { id: ids.city } });
    await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
    await db.$disconnect();
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  // ---------------- 1) طبيب يفعّل ملف مريض ويحجز ----------------

  describe("طبيب يفعّل ملف مريض", () => {
    let doc: Awaited<ReturnType<typeof registerDoctor>>;
    let docToken = "";
    const jar: Jar = {};
    let before: { role: string; doctorId: string; verification: string; subscription: string };

    it("يدخل لوحة الأطباء بدوره الأصلي ولا يملك ملف مريض بعد", async () => {
      doc = await registerDoctor({ verified: true });
      const login = await doctorPortalLogin(doc.email, jar);
      expect(login.status).toBe(200);
      expect(login.data.user.role).toBe("DOCTOR");
      expect(login.data.user.profiles).toMatchObject({ patient: false, canAddPatientProfile: true, canApplyAsDoctor: false });
      docToken = login.data.accessToken;
      const row = await db.doctor.findUniqueOrThrow({ where: { id: doc.doctorId } });
      before = { role: "DOCTOR", doctorId: row.id, verification: row.verificationStatus, subscription: row.subscriptionStatus };
      // واجهة المرضى ترفضه قبل التفعيل (بريده معروف لكن لا ملف مريض).
      const p = await patientPortalLogin(doc.email, {});
      expect(p.status).toBe(401);
    });

    it("كلمة مرور خاطئة → 403 ولا يُنشأ ملف", async () => {
      const r = await call("POST", "/api/auth/profile/patient", { password: "wrong-password" }, docToken);
      expect(r.status).toBe(403);
      expect(await db.patient.count({ where: { userId: doc.userId } })).toBe(0);
    });

    it("حقول غير مسموحة (بريد/دور/معرّف حساب) → 400", async () => {
      for (const extra of [{ email: "x@y.z" }, { role: "ADMIN" }, { userId: ids.users[0] }]) {
        const r = await call("POST", "/api/auth/profile/patient", { password: PASSWORD, ...extra }, docToken);
        expect(r.status).toBe(400);
      }
    });

    it("التفعيل: 201، الدور الأصلي والتوثيق والاشتراك كما هي، الاسم من ملف الطبيب", async () => {
      const r = await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, docToken, jar);
      expect(r.status).toBe(201);
      expect(r.data.created).toBe(true);
      expect(r.data.profiles).toMatchObject({ patient: true, canAddPatientProfile: false });
      // كوكي المرضى ضُبط (مساره الخاص) دون أي رمز في الرابط.
      expect(jar.medbook_patient_refresh).toBeTruthy();
      const user = await db.user.findUniqueOrThrow({ where: { id: doc.userId }, include: { patient: true, doctor: true } });
      expect(user.role).toBe(before.role);
      expect(user.patient?.firstName).toBe("طبيب");
      expect(user.doctor?.verificationStatus).toBe(before.verification);
      expect(user.doctor?.subscriptionStatus).toBe(before.subscription);
      expect(user.doctor?.id).toBe(before.doctorId);
      expect(await db.auditLog.count({ where: { userId: doc.userId, action: "PROFILE_PATIENT_ACTIVATED" } })).toBe(1);
    });

    it("تفعيل ثانٍ: 200 دون تكرار؛ و6 طلبات متزامنة (لحساب آخر) تنتج ملفًا واحدًا فقط", async () => {
      const again = await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, docToken);
      expect(again.status).toBe(200);
      expect(again.data.created).toBe(false);

      const other = await registerDoctor({ verified: true });
      const l = await doctorPortalLogin(other.email, {});
      const results = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/api/auth/profile/patient", { password: PASSWORD }, l.data.accessToken)));
      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(results.filter((r) => r.data?.created === true).length).toBeLessThanOrEqual(1);
      expect(await db.patient.count({ where: { userId: other.userId } })).toBe(1);
      expect(await db.auditLog.count({ where: { userId: other.userId, action: "PROFILE_PATIENT_ACTIVATED" } })).toBe(1);
    });

    it("يدخل واجهة المرضى بالبريد نفسه ويحجز لدى طبيب آخر؛ الموعد على ملف المريض", async () => {
      const pj: Jar = {};
      const login = await patientPortalLogin(doc.email, pj);
      expect(login.status).toBe(200);
      expect(login.data.user.role).toBe("PATIENT");
      expect(login.data.user.profiles).toMatchObject({ patient: true });
      const token = login.data.accessToken as string;
      const me = await call("GET", "/api/patient/auth/me", undefined, token);
      expect(me.status).toBe(200);
      expect(me.data.email).toBe(doc.email);

      const r = await book(token, otherDoctorId);
      expect(r.status).toBe(201);
      const appt = await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } });
      const patient = await db.patient.findUniqueOrThrow({ where: { userId: doc.userId } });
      expect(appt.patientId).toBe(patient.id);
      expect(appt.doctorId).toBe(otherDoctorId);
    });

    it("لا يحجز لدى ملفه المهني (403) لا مباشرة ولا بالتعيين التلقائي", async () => {
      const token = (await patientPortalLogin(doc.email, {})).data.accessToken as string;
      const direct = await book(token, doc.doctorId);
      expect(direct.status).toBe(403);
      expect(await db.appointment.count({ where: { doctorId: doc.doctorId } })).toBe(0);
    });

    it("سياق الطبيب لا يحجز كمريض، وسياق المريض لا يدخل مسارات الطبيب", async () => {
      expect((await book(docToken, otherDoctorId)).status).toBe(403);
      const patientCtx = (await patientPortalLogin(doc.email, {})).data.accessToken as string;
      expect((await call("GET", "/api/appointments/queue", undefined, patientCtx)).status).toBe(403);
      expect((await call("GET", "/api/doctor/dashboard", undefined, patientCtx)).status).toBe(403);
      // وسياق الطبيب ما زال يعمل.
      expect((await call("GET", "/api/appointments/queue", undefined, docToken)).status).toBe(200);
    });
  });

  // ---------------- 2) مريض يقدّم طلب طبيب ----------------

  describe("مريض يقدّم طلب طبيب", () => {
    let pat: Awaited<ReturnType<typeof registerPatient>>;
    const jar: Jar = {};

    it("يدخل لوحة الأطباء بجلسة مريض (بلا صلاحيات طبيب) ويرى أنه يستطيع التقديم", async () => {
      pat = await registerPatient();
      const login = await doctorPortalLogin(pat.email, jar);
      expect(login.status).toBe(200);
      expect(login.data.user.role).toBe("PATIENT");
      expect(login.data.user.profiles).toMatchObject({ patient: true, doctor: null, canApplyAsDoctor: true });
      const t = login.data.accessToken as string;
      expect((await call("GET", "/api/appointments/queue", undefined, t)).status).toBe(403);
      expect((await call("GET", "/api/doctor/dashboard", undefined, t)).status).toBe(403);
    });

    it("يحجز كمريض قبل الاعتماد", async () => {
      const t = (await patientPortalLogin(pat.email, {})).data.accessToken as string;
      const r = await book(t, otherDoctorId, pat.phone);
      expect(r.status).toBe(201);
    });

    it("كلمة مرور خاطئة → 403؛ clinicId/حقول اعتماد → 400؛ لا يُنشأ ملف", async () => {
      const t = (await doctorPortalLogin(pat.email, {})).data.accessToken as string;
      expect((await call("POST", "/api/auth/profile/doctor", { ...doctorForm(), password: "bad" }, t)).status).toBe(403);
      for (const extra of [{ clinicId: ids.city }, { verificationStatus: "VERIFIED" }, { subscriptionStatus: "ACTIVE" }, { email: "a@b.c" }, { phone: "0550000000" }]) {
        expect((await call("POST", "/api/auth/profile/doctor", { ...doctorForm(), ...extra }, t)).status).toBe(400);
      }
      expect(await db.doctor.count({ where: { userId: pat.userId } })).toBe(0);
    });

    it("الطلب: PENDING، الدور الأصلي PATIENT، لا اشتراك نشط، لا ظهور للمرضى", async () => {
      const t = (await doctorPortalLogin(pat.email, jar)).data.accessToken as string;
      const r = await call("POST", "/api/auth/profile/doctor", doctorForm(), t, jar);
      expect(r.status).toBe(201);
      const user = await db.user.findUniqueOrThrow({ where: { id: pat.userId }, include: { doctor: true, patient: true } });
      expect(user.role).toBe("PATIENT");
      expect(user.doctor?.verificationStatus).toBe("PENDING");
      expect(user.doctor?.subscriptionStatus).not.toBe("ACTIVE");
      expect(user.patient?.id).toBe(pat.patientId);
      ids.doctors.push(user.doctor!.id);
      // لا يظهر في القائمة العامة قبل الاعتماد.
      const list = await call("GET", `/api/doctors?wilayaId=${ids.wilaya}&specialtyId=${ids.specialty}&pageSize=50`);
      const found = JSON.stringify(list.data ?? {}).includes(user.doctor!.id);
      expect(found).toBe(false);
      expect(await db.auditLog.count({ where: { userId: pat.userId, action: "PROFILE_DOCTOR_APPLIED" } })).toBe(1);
    });

    it("طلب ثانٍ → 409؛ و6 طلبات متزامنة لحساب آخر → ملف طبيب واحد", async () => {
      // The application route requires patient context even after a doctor profile exists.
      const t = (await patientPortalLogin(pat.email, {})).data.accessToken as string;
      const dup = await call("POST", "/api/auth/profile/doctor", doctorForm(), t);
      expect(dup.status).toBe(409);
      expect(dup.details?.code).toBe("DOCTOR_PROFILE_EXISTS");

      const other = await registerPatient();
      const tok = (await doctorPortalLogin(other.email, {})).data.accessToken as string;
      const results = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/api/auth/profile/doctor", doctorForm(), tok)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      const docs = await db.doctor.findMany({ where: { userId: other.userId } });
      expect(docs).toHaveLength(1);
      ids.doctors.push(docs[0].id);
    });

    it("بعد الطلب: لوحة الأطباء بسياق طبيب (قيد المراجعة) والمريض ما زال يحجز", async () => {
      const dl = await doctorPortalLogin(pat.email, {});
      expect(dl.data.user.role).toBe("DOCTOR");
      expect(dl.data.user.profiles).toMatchObject({ patient: true, doctor: { status: "PENDING" } });
      const me = await call("GET", "/api/auth/me", undefined, dl.data.accessToken);
      expect(me.data.role).toBe("DOCTOR");
      expect(me.data.doctor.verificationStatus).toBe("PENDING");

      const pt = (await patientPortalLogin(pat.email, {})).data.accessToken as string;
      expect((await call("GET", "/api/patient/auth/me", undefined, pt)).status).toBe(200);
      const r = await book(pt, otherDoctorId, pat.phone);
      expect(r.status).toBe(201);
    });

    it("بعد اعتماد الإدارة يبقى استخدامه كمريض متاحًا ويبقى دوره الأصلي", async () => {
      const doctor = await db.doctor.findUniqueOrThrow({ where: { userId: pat.userId } });
      await db.doctor.update({ where: { id: doctor.id }, data: { verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE" } });
      const pt = (await patientPortalLogin(pat.email, {})).data.accessToken as string;
      expect((await book(pt, otherDoctorId, pat.phone)).status).toBe(201);
      expect((await book(pt, doctor.id, pat.phone)).status).toBe(403); // لا يحجز عند نفسه
      const dt = (await doctorPortalLogin(pat.email, {})).data.accessToken as string;
      expect((await call("GET", "/api/appointments/queue", undefined, dt)).status).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { id: pat.userId } })).role).toBe("PATIENT");
    });

    it("طبيب (دوره الأصلي) لا يستطيع تقديم طلب طبيب؛ ومريض لا يفعّل ملف مريض ثانيًا", async () => {
      const d = await registerDoctor();
      const dt = (await doctorPortalLogin(d.email, {})).data.accessToken as string;
      expect((await call("POST", "/api/auth/profile/doctor", doctorForm(), dt)).status).toBe(403);
      const pt = (await patientPortalLogin(pat.email, {})).data.accessToken as string;
      expect((await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, pt)).status).toBe(403);
    });
  });

  // ---------------- 3) الجلسات والانتقال والخروج ----------------

  describe("الجلسات: دخول الواجهتين وتجديدها والانتقال والخروج", () => {
    let acct: Awaited<ReturnType<typeof registerDoctor>>;
    const jar: Jar = {};

    it("دخول الواجهتين وتجديد كلٍّ بكوكيه الخاص بسياقه الصحيح", async () => {
      acct = await registerDoctor({ verified: true });
      const d = await doctorPortalLogin(acct.email, jar);
      const dt = d.data.accessToken as string;
      await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, dt, jar);
      const p = await patientPortalLogin(acct.email, jar);
      expect(p.data.user.role).toBe("PATIENT");

      const rd = await call("POST", "/api/auth/refresh", undefined, undefined, jar);
      expect(rd.status).toBe(200);
      expect(rd.data.user.role).toBe("DOCTOR");
      const rp = await call("POST", "/api/patient/auth/refresh", undefined, undefined, jar);
      expect(rp.status).toBe(200);
      expect(rp.data.user.role).toBe("PATIENT");
      // الرمزان مختلفان وكلٌّ مقيّد بسياقه.
      expect((await call("GET", "/api/appointments/queue", undefined, rd.data.accessToken)).status).toBe(200);
      expect((await call("GET", "/api/appointments/queue", undefined, rp.data.accessToken)).status).toBe(403);
    });

    it("الانتقال من لوحة الأطباء إلى المرضى يضبط كوكي المرضى بلا رمز في الاستجابة أو الرابط", async () => {
      const fresh: Jar = {};
      const d = await doctorPortalLogin(acct.email, fresh);
      const sw = await call("POST", "/api/auth/switch/patient", undefined, d.data.accessToken, fresh);
      expect(sw.status).toBe(200);
      expect(JSON.stringify(sw.raw)).not.toMatch(/accessToken|refreshToken|eyJ/);
      expect(fresh.medbook_patient_refresh).toBeTruthy();
      const rp = await call("POST", "/api/patient/auth/refresh", undefined, undefined, fresh);
      expect(rp.status).toBe(200);
      expect(rp.data.user.role).toBe("PATIENT");
    });

    it("الانتقال من المرضى إلى الأطباء يعمل لمن يملك ملف طبيب ويُرفض (403) لمن لا يملكه", async () => {
      const fresh: Jar = {};
      const p = await patientPortalLogin(acct.email, fresh);
      const sw = await call("POST", "/api/patient/auth/switch/doctor", undefined, p.data.accessToken, fresh);
      expect(sw.status).toBe(200);
      const rd = await call("POST", "/api/auth/refresh", undefined, undefined, fresh);
      expect(rd.data.user.role).toBe("DOCTOR");

      const plain = await registerPatient();
      const pj: Jar = {};
      const pl = await patientPortalLogin(plain.email, pj);
      expect((await call("POST", "/api/patient/auth/switch/doctor", undefined, pl.data.accessToken, pj)).status).toBe(403);
      expect(pj.medbook_refresh).toBeUndefined();
      // وطبيب بلا ملف مريض لا ينتقل إلى المرضى.
      const doc = await registerDoctor();
      const dj: Jar = {};
      const dl = await doctorPortalLogin(doc.email, dj);
      expect((await call("POST", "/api/auth/switch/patient", undefined, dl.data.accessToken, dj)).status).toBe(403);
      expect(dj.medbook_patient_refresh).toBeUndefined();
    });

    it("خروج واجهة واحدة يُبقي الأخرى؛ وخروج allSessions يُنهي الواجهتين", async () => {
      const j1: Jar = {};
      await doctorPortalLogin(acct.email, j1);
      await patientPortalLogin(acct.email, j1);
      await call("POST", "/api/patient/auth/logout", {}, undefined, j1);
      expect((await call("POST", "/api/patient/auth/refresh", undefined, undefined, j1)).status).toBe(401);
      expect((await call("POST", "/api/auth/refresh", undefined, undefined, j1)).status).toBe(200);

      const j2: Jar = {};
      await doctorPortalLogin(acct.email, j2);
      await patientPortalLogin(acct.email, j2);
      const stale = { ...j2 };
      await call("POST", "/api/auth/logout", { allSessions: true }, undefined, j2);
      expect((await call("POST", "/api/auth/refresh", undefined, undefined, stale)).status).toBe(401);
      expect((await call("POST", "/api/patient/auth/refresh", undefined, undefined, stale)).status).toBe(401);
      expect(await db.refreshToken.count({ where: { userId: acct.userId, revoked: false } })).toBe(0);
    });

    it("allSessions بكوكي غير صالح لا يمسّ جلسات أحد", async () => {
      const keep: Jar = {};
      await doctorPortalLogin(acct.email, keep);
      const bogus: Jar = { medbook_refresh: "not-a-real-token" };
      await call("POST", "/api/auth/logout", { allSessions: true }, undefined, bogus);
      expect((await call("POST", "/api/auth/refresh", undefined, undefined, keep)).status).toBe(200);
    });

    it("تعطيل الحساب يقطع الواجهتين فورًا، وحذف ملف المريض يقطع سياقه", async () => {
      const u = await registerDoctor({ verified: true });
      const dt = (await doctorPortalLogin(u.email, {})).data.accessToken as string;
      await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, dt);
      const pt = (await patientPortalLogin(u.email, {})).data.accessToken as string;
      expect((await call("GET", "/api/patient/auth/me", undefined, pt)).status).toBe(200);
      const patient = await db.patient.findUniqueOrThrow({ where: { userId: u.userId } });
      await db.patient.delete({ where: { id: patient.id } });
      expect((await call("GET", "/api/patient/auth/me", undefined, pt)).status).toBe(403);
      expect((await call("GET", "/api/appointments/queue", undefined, dt)).status).toBe(200);
      await db.user.update({ where: { id: u.userId }, data: { isActive: false } });
      expect((await call("GET", "/api/appointments/queue", undefined, dt)).status).toBe(401);
    });
  });

  // ---------------- 4) عدم اكتساب صلاحيات ----------------

  describe("عدم اكتساب صلاحيات غير مصرح بها", () => {
    it("مطالبة السياق في التوكن لا تُقبل إلا مع وجود الملف", async () => {
      const patientOnly = await registerPatient();
      const doctorOnly = await registerDoctor({ verified: true });
      // مريض بلا ملف طبيب يدّعي DOCTOR أو ADMIN
      expect((await call("GET", "/api/appointments/queue", undefined, sign({ sub: patientOnly.userId, role: "DOCTOR" }))).status).toBe(403);
      expect((await call("GET", "/api/admin/stats", undefined, sign({ sub: patientOnly.userId, role: "ADMIN" }))).status).toBe(403);
      // طبيب بلا ملف مريض يدّعي PATIENT
      expect((await call("GET", "/api/patient/auth/me", undefined, sign({ sub: doctorOnly.userId, role: "PATIENT" }))).status).toBe(403);
      expect((await book(sign({ sub: doctorOnly.userId, role: "PATIENT" }), otherDoctorId)).status).toBe(403);
      // طبيب بملفين يدّعي ADMIN أو ASSISTANT
      const dt = (await doctorPortalLogin(doctorOnly.email, {})).data.accessToken as string;
      await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, dt);
      for (const role of ["ADMIN", "ASSISTANT", "CLINIC_OWNER"]) {
        expect((await call("GET", "/api/auth/me", undefined, sign({ sub: doctorOnly.userId, role }))).status).toBe(403);
      }
    });

    it("مدير/مساعد/مالك عيادة لا يفعّلون ملفًا ولا يقدّمون طلبًا ولا ينتقلون", async () => {
      const adminId = (await db.user.findFirstOrThrow({ where: { email: `${tag}-admin@test.local` } })).id;
      const t = sign({ sub: adminId, role: "ADMIN" });
      expect((await call("POST", "/api/auth/profile/patient", { password: "x" }, t)).status).toBe(403);
      expect((await call("POST", "/api/auth/profile/doctor", doctorForm(), t)).status).toBe(403);
      expect((await call("POST", "/api/auth/switch/patient", undefined, t)).status).toBe(403);
      expect((await call("POST", "/api/patient/auth/switch/doctor", undefined, t)).status).toBe(403);
      expect((await call("POST", "/api/patient/auth/login", { email: `${tag}-admin@test.local`, password: "x" })).status).toBe(401);
    });

    it("لا معرّف حساب من الجسم: التفعيل يخص صاحب الجلسة فقط", async () => {
      const victim = await registerDoctor({ verified: true });
      const attacker = await registerDoctor({ verified: true });
      const at = (await doctorPortalLogin(attacker.email, {})).data.accessToken as string;
      const r = await call("POST", "/api/auth/profile/patient", { password: PASSWORD, userId: victim.userId }, at);
      expect(r.status).toBe(400);
      expect(await db.patient.count({ where: { userId: victim.userId } })).toBe(0);
    });
  });

  // ---------------- 5) التسجيل ببريد/هاتف موجود ----------------

  describe("التسجيل ببريد أو هاتف موجود", () => {
    it("يوجّه إلى الدخول ولا يربط ولا يغيّر كلمة المرور ولا ينشئ ملفًا", async () => {
      const doc = await registerDoctor({ verified: true });
      const before = await db.user.findUniqueOrThrow({ where: { id: doc.userId } });

      const viaPatientSite = await call("POST", "/api/patient/auth/register", { email: doc.email, password: "Attacker-pass-1", name: "مهاجم" });
      expect(viaPatientSite.status).toBe(409);
      expect(viaPatientSite.details?.code).toBe("ACCOUNT_EXISTS");
      const sameCase = await call("POST", "/api/patient/auth/register", { email: doc.email.toUpperCase(), password: "Attacker-pass-1", name: "مهاجم" });
      expect(sameCase.status).toBe(409);
      const byPhone = await call("POST", "/api/patient/auth/register", { email: `${tag}-new@test.local`, password: "Attacker-pass-1", name: "مهاجم", phone: doc.phone });
      expect(byPhone.status).toBe(409);
      expect(byPhone.details?.code).toBe("ACCOUNT_EXISTS");

      const pat = await registerPatient();
      const viaDoctorSite = await call("POST", "/api/auth/register/doctor", {
        email: pat.email, password: "Attacker-pass-1", firstName: "مهاجم", lastName: "مهاجم",
        specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
      });
      expect(viaDoctorSite.status).toBe(409);
      expect(viaDoctorSite.details?.code).toBe("ACCOUNT_EXISTS");
      const patSite2 = await call("POST", "/api/auth/register/patient", { email: doc.email, password: "Attacker-pass-1", firstName: "مهاجم", lastName: "مهاجم" });
      expect(patSite2.status).toBe(409);

      const after = await db.user.findUniqueOrThrow({ where: { id: doc.userId } });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.phone).toBe(before.phone);
      expect(await db.patient.count({ where: { userId: doc.userId } })).toBe(0);
      expect(await db.doctor.count({ where: { userId: pat.userId } })).toBe(0);
      // كلمة المرور الأصلية ما زالت تعمل والجديدة لا.
      expect((await doctorPortalLogin(doc.email, {})).status).toBe(200);
      expect((await call("POST", "/api/auth/login", { email: doc.email, password: "Attacker-pass-1" })).status).toBe(401);
    });
  });

  // ---------------- 6) سلامة الأدوار والبيانات الأخرى ----------------

  describe("بقاء الأدوار الأخرى والمواعيد والاشتراكات سليمة", () => {
    it("مواعيد الطبيب واشتراكه وتوثيقه لا تتغير بعد تفعيل ملف المريض", async () => {
      const doc = await registerDoctor({ verified: true });
      const pat = await registerPatient();
      const a = await db.appointment.create({
        data: { patientId: pat.patientId, doctorId: doc.doctorId, date: new Date("2030-01-10T00:00:00Z"), startTime: "10:00", endTime: "10:15", status: "CONFIRMED" },
      });
      const snap = async () => JSON.stringify({
        d: await db.doctor.findUniqueOrThrow({ where: { id: doc.doctorId } }),
        a: await db.appointment.findMany({ where: { doctorId: doc.doctorId }, orderBy: { id: "asc" } }),
        u: (await db.user.findUniqueOrThrow({ where: { id: doc.userId } })).role,
      });
      const before = JSON.parse(await snap());
      const dt = (await doctorPortalLogin(doc.email, {})).data.accessToken as string;
      expect((await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, dt)).status).toBe(201);
      const after = JSON.parse(await snap());
      // updatedAt قد يتحرك فقط إن حدث تحديث؛ لا نتوقعه، فنقارن الحقول الجوهرية.
      for (const k of ["verificationStatus", "subscriptionStatus", "subscriptionExpiresAt", "clinicId", "newDoctorTrial", "trialStartedAt", "consultationFee"]) {
        expect(after.d[k]).toEqual(before.d[k]);
      }
      expect(after.a).toEqual(before.a);
      expect(after.u).toBe("DOCTOR");
      expect(a.id).toBe(after.a[0].id);
    });

    it("طبيب عادي ومريض عادي ومساعد وإدارة: دخولهم ومساراتهم كما كانت", async () => {
      const doc = await registerDoctor({ verified: true });
      const dl = await doctorPortalLogin(doc.email, {});
      expect(dl.data.user.role).toBe("DOCTOR");
      expect((await call("GET", "/api/appointments/queue", undefined, dl.data.accessToken)).status).toBe(200);
      expect((await call("GET", "/api/auth/me", undefined, dl.data.accessToken)).data.role).toBe("DOCTOR");

      const pat = await registerPatient();
      const pl = await patientPortalLogin(pat.email, {});
      expect(pl.data.user.role).toBe("PATIENT");
      expect((await book(pl.data.accessToken, otherDoctorId, pat.phone)).status).toBe(201);
      expect((await call("GET", "/api/appointments/queue", undefined, pl.data.accessToken)).status).toBe(403);

      const au = await db.user.create({ data: { email: `${tag}-asst@test.local`, passwordHash: "x", role: "ASSISTANT" } });
      ids.users.push(au.id);
      await db.assistant.create({ data: { userId: au.id, doctorId: doc.doctorId, firstName: "م", lastName: tag } });
      expect((await call("GET", "/api/appointments/queue", undefined, sign({ sub: au.id, role: "ASSISTANT" }))).status).toBe(200);
      expect((await call("GET", "/api/admin/stats", undefined, adminToken)).status).toBe(200);
    });

    it("إشعارات حساب الملفين تُفصل بحسب الواجهة؛ وحساب بملف واحد لا يتأثر", async () => {
      const doc = await registerDoctor({ verified: true });
      const dj: Jar = {};
      const dt = (await doctorPortalLogin(doc.email, dj)).data.accessToken as string;
      await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, dt, dj);
      const patient = await db.patient.findUniqueOrThrow({ where: { userId: doc.userId } });
      const mk = (type: string, extra: Record<string, unknown> = {}) => db.notification.create({ data: { userId: doc.userId, type, title: type, message: type, ...extra } });
      const apptAsDoctor = await db.appointment.create({ data: { doctorId: doc.doctorId, guestFirstName: "ض", guestLastName: "ض", guestPhone: "0551111111", date: new Date("2030-02-01T00:00:00Z"), startTime: "09:00", endTime: "09:15", status: "CONFIRMED" } });
      const apptAsPatient = await db.appointment.create({ data: { doctorId: otherDoctorId, patientId: patient.id, date: new Date("2030-02-01T00:00:00Z"), startTime: "11:00", endTime: "11:15", status: "CONFIRMED" } });
      await mk("NEW_MESSAGE");
      await mk("NEW_DOCTOR_IN_AREA");
      await mk("APPOINTMENT_CANCELLED", { appointmentId: apptAsDoctor.id });
      await mk("APPOINTMENT_CANCELLED", { appointmentId: apptAsPatient.id });
      const pt = (await patientPortalLogin(doc.email, {})).data.accessToken as string;
      const pList = (await call("GET", "/api/notifications", undefined, pt)).data as Array<{ type: string; appointmentId: string | null }>;
      const dList = (await call("GET", "/api/notifications", undefined, dt)).data as Array<{ type: string; appointmentId: string | null }>;
      expect(pList.map((n) => n.type).sort()).toEqual(["APPOINTMENT_CANCELLED", "NEW_DOCTOR_IN_AREA"]);
      expect(pList.find((n) => n.appointmentId)?.appointmentId).toBe(apptAsPatient.id);
      expect(dList.map((n) => n.type)).toEqual(["NEW_MESSAGE"]);
      expect(dList.some((n) => n.appointmentId)).toBe(false);

      // حساب بملف واحد: كل إشعاراته تظهر كما كانت.
      const single = await registerDoctor({ verified: true });
      await db.notification.create({ data: { userId: single.userId, type: "NEW_DOCTOR_IN_AREA", title: "t", message: "m" } });
      await db.notification.create({ data: { userId: single.userId, type: "NEW_MESSAGE", title: "t", message: "m" } });
      const st = (await doctorPortalLogin(single.email, {})).data.accessToken as string;
      expect(((await call("GET", "/api/notifications", undefined, st)).data as unknown[]).length).toBe(2);
    });

    it("إعلان «طبيب جديد في ولايتك» لا يصل لحساب الطبيب نفسه إن كان يحمل ملف مريض في الولاية ذاتها", async () => {
      const { queueNewDoctorAreaNotifications } = await import("../../src/modules/notifications/newDoctorArea.service");
      const doc = await registerDoctor({ verified: true });
      const dt = (await doctorPortalLogin(doc.email, {})).data.accessToken as string;
      await call("POST", "/api/auth/profile/patient", { password: PASSWORD, cityId: ids.city }, dt);
      const other = await registerPatient();
      await db.patient.update({ where: { id: other.patientId }, data: { cityId: ids.city } });
      const row = await db.doctor.findUniqueOrThrow({ where: { id: doc.doctorId }, include: { city: true, specialty: true, clinic: true } });
      const recipients = await db.$transaction((tx) => queueNewDoctorAreaNotifications(tx, row));
      expect(recipients).toContain(other.userId);
      expect(recipients).not.toContain(doc.userId);
    });

    it("قائمة المستخدمين للإدارة: فلتر «مريض» و«طبيب» يشمل حساب الملفين مع البحث", async () => {
      const doc = await registerDoctor({ verified: true });
      const dt = (await doctorPortalLogin(doc.email, {})).data.accessToken as string;
      await call("POST", "/api/auth/profile/patient", { password: PASSWORD }, dt);
      const q = encodeURIComponent(doc.email);
      const asPatient = await call("GET", `/api/admin/users?role=PATIENT&q=${q}`, undefined, adminToken);
      const asDoctor = await call("GET", `/api/admin/users?role=DOCTOR&q=${q}`, undefined, adminToken);
      expect(asPatient.data.items.map((u: any) => u.id)).toContain(doc.userId);
      expect(asDoctor.data.items.map((u: any) => u.id)).toContain(doc.userId);
      const unrelated = await call("GET", `/api/admin/users?role=PATIENT&q=${encodeURIComponent(`${tag}-nomatch`)}`, undefined, adminToken);
      expect(unrelated.data.items).toHaveLength(0);
    });
  });
});
