/**
 * مسارات الشروط المالية عبر PostgreSQL وPrisma حقيقيين:
 * مالك العيادة الطبيب، الدعوة بشروط، طلب الانتقال والموافقة، اتساق سعر المريض، ثبات اللقطة، الخصوصية، upsert وgroupBy.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_terms_test" npx vitest run clinicTermsFlow
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname) || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}
const dayStr = (n: number) => {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n)).toISOString().slice(0, 10);
};
const LEAK = /SharePercent|clinicTerms|"financial"|termsDoctor|clinicShare/;

describe.skipIf(!TEST_URL)("شروط العيادة: المسارات الكاملة (PostgreSQL حقيقي)", () => {
  let server: http.Server; let base: string; let db: PrismaClient;
  let sign: typeof import("../../src/utils/jwt").signAccessToken;
  const tag = `tf${Date.now().toString(36)}`;
  const created = { users: [] as string[], doctors: [] as string[], clinics: [] as string[], wilaya: "", city: "", specialty: "" };
  let seq = 0; let adminToken = ""; let patientToken = ""; let patientId = "";

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, text: JSON.stringify(j) };
  };
  const email = () => `${tag}-${++seq}@test.local`;
  const location = () => ({ wilayaId: created.wilaya, cityId: created.city });
  const future = () => new Date(Date.now() + 90 * 86400000);
  const bookable = async (doctorId: string) => {
    await db.doctor.update({ where: { id: doctorId }, data: { verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", slotDurationMin: 15 } });
    await db.doctorSchedule.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ doctorId, dayOfWeek, startTime: "09:00", endTime: "12:00" })) });
  };
  const activateClinic = (id: string) => db.clinic.update({ where: { id }, data: { verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", subscriptionExpiresAt: future(), paidDoctorCount: 10 } });
  async function registerOwner(withDoctor: boolean) {
    const r = await call("POST", "/api/auth/register/clinic", {
      email: email(), password: "ClinicTest123!", clinic: { nameAr: `عيادة ${tag}${seq}`, address: "شارع الاختبار", ...location() },
      ...(withDoctor ? { doctor: { firstName: "مالك", lastName: `طبيب${seq}`, specialtyId: created.specialty } } : {}),
    });
    expect(r.status).toBe(201);
    const user = r.data.user; created.users.push(user.id);
    const clinicId = user.ownedClinic.id as string; created.clinics.push(clinicId);
    if (user.doctor?.id) created.doctors.push(user.doctor.id);
    await activateClinic(clinicId);
    return { token: r.data.accessToken as string, clinicId, doctorId: (user.doctor?.id ?? null) as string | null, userId: user.id as string };
  }
  async function independentDoctor(fee: number) {
    const u = await db.user.create({ data: { email: email(), passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({ data: { userId: u.id, firstName: "مستقل", lastName: tag, specialtyId: created.specialty, ...location(), consultationFee: fee } });
    created.users.push(u.id); created.doctors.push(d.id);
    await bookable(d.id);
    return { id: d.id, userId: u.id, email: u.email, token: sign({ sub: u.id, role: "DOCTOR" }) };
  }
  const book = (doctorId: string, date: string) => call("POST", "/api/booking", { firstName: "سارة", lastName: "بن يوسف", phone: "0551234567", ...location(), specialtyId: created.specialty, doctorId, date }, patientToken);
  const setTerms = (token: string, doctorId: string, body: unknown) => call("PATCH", `/api/clinics/mine/doctors/${doctorId}/terms`, body, token);
  const snap = (appointmentId: string) => db.appointmentFinancial.findUnique({ where: { appointmentId } });

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL; process.env.RATE_LIMIT_MAX = "1000000"; process.env.REMINDERS_ENABLED = "false";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(created, { wilaya: w.id, city: c.id, specialty: s.id });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const admin = await db.user.create({ data: { email: email(), passwordHash: "x", role: "ADMIN" } });
    created.users.push(admin.id); adminToken = sign({ sub: admin.id, role: "ADMIN" });
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const reg = await call("POST", "/api/patient/auth/register", { email: email(), password: "Secret123!", name: "مريض اختبار", phone: `07${String(Date.now()).slice(-8)}` });
    expect(reg.status).toBe(201);
    created.users.push(reg.data.user.id); patientToken = reg.data.accessToken;
    patientId = (await db.patient.findUniqueOrThrow({ where: { userId: reg.data.user.id } })).id;
  }, 60000);

  beforeEach(async () => {
    const { authLimiter } = await import("../../src/middleware/rateLimiter");
    for (const a of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) authLimiter.resetKey(a);
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    created.doctors = created.doctors.filter(Boolean); created.users = created.users.filter(Boolean);
    const docs = { in: created.doctors };
    await db.auditLog.deleteMany({ where: { userId: { in: created.users } } });
    await db.notification.deleteMany({ where: { userId: { in: created.users } } });
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: docs } } });
    await db.appointment.deleteMany({ where: { doctorId: docs } });
    await db.clinicTransferRequest.deleteMany({ where: { clinicId: { in: created.clinics } } });
    await db.clinicDoctorInvite.deleteMany({ where: { clinicId: { in: created.clinics } } });
    await db.clinicDoctorTerms.deleteMany({ where: { clinicId: { in: created.clinics } } });
    await db.assistant.deleteMany({ where: { doctorId: docs } });
    await db.doctorSchedule.deleteMany({ where: { doctorId: docs } });
    await db.doctor.deleteMany({ where: { OR: [{ id: docs }, { user: { email: { startsWith: tag } } }] } });
    await db.clinic.deleteMany({ where: { id: { in: created.clinics } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: created.users } } });
    await db.patient.deleteMany({ where: { userId: { in: created.users } } });
    await db.user.deleteMany({ where: { OR: [{ id: { in: created.users } }, { email: { startsWith: tag } }] } });
    await db.specialty.deleteMany({ where: { id: created.specialty } });
    await db.city.deleteMany({ where: { id: created.city } });
    await db.wilaya.deleteMany({ where: { id: created.wilaya } });
    await db.$disconnect();
  });

  it("مالك العيادة الطبيب كأي طبيب: لا 100% تلقائية، ويحدد سعره ونسبته بنفسه", async () => {
    const o = await registerOwner(true);
    expect(o.doctorId).toBeTruthy();
    // قد يبقى انضمامه معلقًا للإدارة (كما قبل الميزة)؛ ننهيه كما تفعل الإدارة.
    const pending = await db.clinicTransferRequest.findFirst({ where: { doctorId: o.doctorId!, status: "PENDING" } });
    if (pending) expect((await call("PATCH", `/api/clinics/admin/transfers/${pending.id}`, { approve: true }, adminToken)).status).toBe(200);
    expect(await db.clinicDoctorTerms.count({ where: { doctorId: o.doctorId! } })).toBe(0);
    await bookable(o.doctorId!);
    const mine = await call("GET", "/api/clinics/mine", undefined, o.token);
    const self = mine.data.doctors.find((d: any) => d.id === o.doctorId);
    expect(self.terms.doctorSharePercent).toBeNull();
    expect(self.terms.clinicSharePercent).toBeNull();
    const first = await book(o.doctorId!, dayStr(1));
    expect(first.status).toBe(201);
    expect(await snap(first.data.id)).toMatchObject({ doctorSharePercent: null });
    const set = await setTerms(o.token, o.doctorId!, { appointmentPriceDzd: 3000, doctorSharePercent: 70 });
    expect(set.status).toBe(200);
    expect(set.data).toMatchObject({ appointmentPriceDzd: 3000, doctorSharePercent: 70, clinicSharePercent: 30 });
    const second = await book(o.doctorId!, dayStr(2));
    expect(await snap(second.data.id)).toMatchObject({ priceDzd: 3000, doctorSharePercent: 70 });
    // يرى شروطه كأي طبيب (دوره DOCTOR) ويظهر في لوحته مستحقاته
    const own = await call("GET", "/api/doctor/clinic-terms", undefined, o.token);
    expect(own.data).toMatchObject({ inClinic: true, appointmentPriceDzd: 3000, doctorSharePercent: 70, clinicSharePercent: 30 });
    const dash = await call("GET", "/api/doctor/dashboard", undefined, o.token);
    expect(dash.data.clinicEarnings).toMatchObject({ doctorSharePercent: 70, appointmentPriceDzd: 3000 });
    // موعده السابق لا يتغير
    expect(await snap(first.data.id)).toMatchObject({ doctorSharePercent: null });
  });

  it("الدعوة بشروط: تُرفض القيم الخاطئة، وتُطبَّق عند تسجيل الطبيب الجديد", async () => {
    const o = await registerOwner(false);
    for (const bad of [{ doctorSharePercent: 101 }, { doctorSharePercent: -1 }, { doctorSharePercent: 80.5 }, { appointmentPriceDzd: -5 }, { appointmentPriceDzd: 1.5 }]) {
      expect((await call("POST", "/api/clinics/mine/invites", { email: email(), ...bad }, o.token)).status).toBe(400);
    }
    const target = email();
    const inv = await call("POST", "/api/clinics/mine/invites", { email: target, appointmentPriceDzd: 2200, doctorSharePercent: 85 }, o.token);
    expect(inv.status).toBe(201);
    const stored = await db.clinicDoctorInvite.findFirstOrThrow({ where: { clinicId: o.clinicId } });
    expect(stored).toMatchObject({ termsPriceDzd: 2200, termsDoctorSharePercent: 85 });
    const reg = await call("POST", "/api/auth/register/clinic-doctor", { token: inv.data.rawToken, password: "ClinicTest123!", doctor: { firstName: "جديد", lastName: tag, specialtyId: created.specialty } });
    expect(reg.status).toBe(201);
    const doctorId = reg.data.doctor?.id ?? (await db.doctor.findFirstOrThrow({ where: { user: { email: target } } })).id;
    if (reg.data.id) created.users.push(reg.data.id);
    created.doctors.push(doctorId);
    expect(await db.clinicDoctorTerms.findUnique({ where: { doctorId } })).toMatchObject({ clinicId: o.clinicId, appointmentPriceDzd: 2200, doctorSharePercent: 85 });
    await bookable(doctorId);
    const ap = await book(doctorId, dayStr(1));
    expect(await snap(ap.data.id)).toMatchObject({ priceDzd: 2200, doctorSharePercent: 85, clinicId: o.clinicId });
  });

  it("طبيب مسجّل: ينضم وتُطبّق الشروط عند قبول الدعوة دون موافقة الإدارة", async () => {
    const o = await registerOwner(false);
    const doc = await independentDoctor(1700);
    const inv = await call("POST", "/api/clinics/mine/invites", { email: doc.email, appointmentPriceDzd: 2600, doctorSharePercent: 75 }, o.token);
    expect(inv.status).toBe(201);
    const before = await db.doctor.findUniqueOrThrow({ where: { id: doc.id } });
    const pending = await call("POST", "/api/clinics/transfers", { clinicId: o.clinicId }, doc.token);
    expect(pending.status).toBe(201);
    const preview = await call("GET", `/api/clinics/invites/${inv.data.rawToken}`);
    expect(preview.data).toMatchObject({ existingAccount: true, appointmentPriceDzd: 2600, doctorSharePercent: 75 });
    const acc = await call("POST", "/api/clinics/invites/accept", { token: inv.data.rawToken }, doc.token);
    expect(acc.status).toBe(200);
    expect(acc.data.clinicId).toBe(o.clinicId);
    expect(await db.clinicTransferRequest.findUnique({ where: { id: pending.data.id } })).toMatchObject({ status: "REVOKED", pendingDoctorId: null });
    expect((await call("PATCH", `/api/clinics/admin/transfers/${pending.data.id}`, { approve: true }, adminToken)).status).toBe(409);
    expect(await db.clinicDoctorTerms.findUnique({ where: { doctorId: doc.id } })).toMatchObject({ clinicId: o.clinicId, appointmentPriceDzd: 2600, doctorSharePercent: 75 });
    expect((await db.doctor.findUniqueOrThrow({ where: { id: doc.id } })).consultationFee).toBe(1700); // خارج العيادة لا يتغير
    expect(await db.doctor.findUnique({ where: { id: doc.id } })).toMatchObject({ subscriptionStatus: before.subscriptionStatus, subscriptionExpiresAt: before.subscriptionExpiresAt, verificationStatus: before.verificationStatus });
    const ap = await book(doc.id, dayStr(1));
    expect(await snap(ap.data.id)).toMatchObject({ priceDzd: 2600, doctorSharePercent: 75 });
  });

  it("رفض الانتقال لا ينشئ شروطًا، وانتقال بلا شروط يزيل شروط العيادة السابقة ولا يرثها المدير الجديد", async () => {
    const a = await registerOwner(false); const b = await registerOwner(false);
    const doc = await independentDoctor(1600);
    await call("POST", "/api/clinics/transfers", { clinicId: a.clinicId }, doc.token);
    const req1 = await db.clinicTransferRequest.findFirstOrThrow({ where: { doctorId: doc.id, status: "PENDING" } });
    expect((await call("PATCH", `/api/clinics/admin/transfers/${req1.id}`, { approve: false }, adminToken)).status).toBe(200);
    expect(await db.clinicDoctorTerms.count({ where: { doctorId: doc.id } })).toBe(0);
    // ينضم لعيادة A بشروط ثم يغادرها إداريًا (محاكاة) وينتقل إلى B بلا شروط
    await call("POST", "/api/clinics/transfers", { clinicId: a.clinicId }, doc.token);
    const req2 = await db.clinicTransferRequest.findFirstOrThrow({ where: { doctorId: doc.id, status: "PENDING" } });
    await call("PATCH", `/api/clinics/admin/transfers/${req2.id}`, { approve: true }, adminToken);
    expect((await setTerms(a.token, doc.id, { appointmentPriceDzd: 2000, doctorSharePercent: 90 })).status).toBe(200);
    await db.doctor.update({ where: { id: doc.id }, data: { clinicId: null } });
    const inv = await call("POST", "/api/clinics/mine/invites", { email: doc.email }, b.token);
    expect((await call("POST", "/api/clinics/invites/accept", { token: inv.data.rawToken }, doc.token)).status).toBe(200);
    expect(await db.clinicDoctorTerms.count({ where: { doctorId: doc.id } })).toBe(0); // شروط A أُزيلت
    const ap = await book(doc.id, dayStr(1));
    expect(await snap(ap.data.id)).toMatchObject({ priceDzd: 1600, doctorSharePercent: null, clinicId: b.clinicId });
    // مدير B يضبط السعر وحده: لا نسبة موروثة
    const only = await setTerms(b.token, doc.id, { appointmentPriceDzd: 1900 });
    expect(only.data).toMatchObject({ appointmentPriceDzd: 1900, doctorSharePercent: null });
  });

  it("upsert: التعديل المتكرر والمتزامن يبقي صفًا واحدًا ويُسجَّل في AuditLog", async () => {
    const o = await registerOwner(false);
    const doc = await independentDoctor(1500);
    await db.doctor.update({ where: { id: doc.id }, data: { clinicId: o.clinicId } });
    const results = await Promise.all([1, 2, 3, 4, 5].map(n => setTerms(o.token, doc.id, { appointmentPriceDzd: 1000 + n * 100, doctorSharePercent: 50 + n })));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(await db.clinicDoctorTerms.count({ where: { doctorId: doc.id } })).toBe(1);
    expect((await setTerms(o.token, doc.id, { doctorSharePercent: 80 })).data).toMatchObject({ doctorSharePercent: 80 });
    expect(await db.auditLog.count({ where: { action: "CLINIC_DOCTOR_TERMS_UPDATED", entityId: (await db.clinicDoctorTerms.findUniqueOrThrow({ where: { doctorId: doc.id } })).id } })).toBe(6);
    // قيود قاعدة البيانات خط دفاع أخير حتى لو تجاوز أحدهم الخادم
    await expect(db.$executeRawUnsafe(`UPDATE clinic_doctor_terms SET "doctorSharePercent" = 101 WHERE "doctorId" = '${doc.id}'`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE clinic_doctor_terms SET "appointmentPriceDzd" = -1 WHERE "doctorId" = '${doc.id}'`)).rejects.toThrow();
  });

  it("اتساق سعر المريض في كل واجهة، وثبات اللقطة بعد تعديل السعر، وبلا أي تسرب للنسب", async () => {
    const o = await registerOwner(false);
    const docA = await independentDoctor(1500); const docB = await independentDoctor(1800);
    await db.doctor.updateMany({ where: { id: { in: [docA.id, docB.id] } }, data: { clinicId: o.clinicId } });
    await setTerms(o.token, docA.id, { appointmentPriceDzd: 2000, doctorSharePercent: 80 });
    await setTerms(o.token, docB.id, { appointmentPriceDzd: 2500, doctorSharePercent: 85 });

    const before = await call("GET", `/api/doctors/${docA.id}`);
    expect(before.data.consultationFee).toBe(2000);
    const booked = await book(docA.id, dayStr(1));
    expect(booked.status).toBe(201);
    expect(booked.data.priceDzd).toBe(2000);
    expect(booked.data.doctor.consultationFee).toBe(2000);
    const apId = booked.data.id;

    const readers = async () => {
      const list = await call("GET", "/api/appointments", undefined, patientToken);
      const item = list.data.find((a: any) => a.id === apId);
      const status = await call("GET", `/api/booking/status/${apId}`);
      return { list, item, status };
    };
    let r = await readers();
    expect(r.item.priceDzd).toBe(2000); expect(r.item.doctor.consultationFee).toBe(2000);
    expect(r.status.data.priceDzd).toBe(2000);

    // المدير يرفع السعر: العرض العام والحجوزات الجديدة بالسعر الجديد، والموعد القائم على لقطته
    expect((await setTerms(o.token, docA.id, { appointmentPriceDzd: 2600 })).status).toBe(200);
    expect((await call("GET", `/api/doctors/${docA.id}`)).data.consultationFee).toBe(2600);
    r = await readers();
    expect(r.item.priceDzd).toBe(2000); expect(r.item.doctor.consultationFee).toBe(2000);
    expect(r.status.data.priceDzd).toBe(2000);
    const later = await book(docA.id, dayStr(2));
    expect(later.data.priceDzd).toBe(2600); expect(later.data.doctor.consultationFee).toBe(2600);
    expect(await snap(apId)).toMatchObject({ priceDzd: 2000, doctorSharePercent: 80 });

    // الإلغاء من المريض يعيد نفس سعر اللقطة
    const cancelled = await call("DELETE", `/api/appointments/${apId}`, undefined, patientToken);
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.priceDzd).toBe(2000);

    // موعد قديم بلا لقطة (قبل الميزة): السعر الفعلي الحالي في كل الحقول
    const legacy = await db.appointment.create({ data: { patientId, doctorId: docB.id, date: new Date(dayStr(3) + "T00:00:00Z"), startTime: "10:00", endTime: "10:15", status: "CONFIRMED", guestFirstName: "ق", guestLastName: "ق", createdBy: "PATIENT" }, select: { id: true } });
    r = await readers();
    const legacyItem = r.list.data.find((a: any) => a.id === legacy.id);
    expect(legacyItem.priceDzd).toBe(2500); expect(legacyItem.doctor.consultationFee).toBe(2500);

    // الخصوصية: لا نسبة ولا شروط في أي رد للمريض
    for (const x of [before.text, booked.text, later.text, cancelled.text, r.list.text, r.status.text]) expect(x).not.toMatch(LEAK);
    expect((await call("GET", `/api/clinics/${o.clinicId}`)).text).not.toMatch(LEAK);
    expect((await call("GET", "/api/doctors")).text).not.toMatch(LEAK);

    // كل طبيب يرى شروطه وحده
    const ownA = await call("GET", "/api/doctor/clinic-terms", undefined, docA.token);
    expect(ownA.data).toMatchObject({ inClinic: true, appointmentPriceDzd: 2600, doctorSharePercent: 80, clinicSharePercent: 20 });
    const ownB = await call("GET", "/api/doctor/clinic-terms", undefined, docB.token);
    expect(ownB.data).toMatchObject({ doctorSharePercent: 85 });
    expect(ownA.text).not.toContain("85"); expect(ownB.text).not.toContain('"doctorSharePercent":80');
    for (const t of [docA.token, docB.token]) {
      const apps = await call("GET", "/api/appointments", undefined, t);
      expect(apps.text).not.toMatch(LEAK);
      expect((await call("GET", "/api/doctors/" + docA.id, undefined, t)).text).not.toMatch(LEAK);
    }
    // طبيب لا يستطيع قراءة تقرير العيادة ولا تعديل شروط زميله
    expect((await call("GET", "/api/clinics/mine/finance", undefined, docA.token)).status).toBe(404);
    expect((await setTerms(docA.token, docB.id, { doctorSharePercent: 1 })).status).toBeGreaterThanOrEqual(403);
    expect(await db.clinicDoctorTerms.findUnique({ where: { doctorId: docB.id } })).toMatchObject({ doctorSharePercent: 85 });
  });

  it("المساعد لا يرى أي سعر أو نسبة أو مستحقات", async () => {
    const o = await registerOwner(false);
    const doc = await independentDoctor(1500);
    await db.doctor.update({ where: { id: doc.id }, data: { clinicId: o.clinicId } });
    await setTerms(o.token, doc.id, { appointmentPriceDzd: 2000, doctorSharePercent: 80 });
    const au = await db.user.create({ data: { email: email(), passwordHash: "x", role: "ASSISTANT" } });
    created.users.push(au.id);
    await db.assistant.create({ data: { userId: au.id, doctorId: doc.id, firstName: "م", lastName: "س" } });
    const token = sign({ sub: au.id, role: "ASSISTANT" });
    const ap = await book(doc.id, dayStr(1));
    expect(ap.status).toBe(201);
    const dash = await call("GET", "/api/doctor/dashboard", undefined, token);
    expect(dash.status).toBe(200);
    expect(dash.text).not.toMatch(LEAK);
    expect(dash.data.clinicEarnings).toBeUndefined();
    expect((await call("GET", "/api/appointments", undefined, token)).text).not.toMatch(LEAK);
    expect((await call("GET", "/api/appointments/queue", undefined, token)).text).not.toMatch(LEAK);
    expect((await call("GET", "/api/doctor/clinic-terms", undefined, token)).status).toBe(403);
  });

  it("لوحة الطبيب وتقرير المدير عبر groupBy الحقيقي: المكتمل فقط، وعدّاد بلا نسبة، وتحذير التقدير", async () => {
    const o = await registerOwner(false);
    const doc = await independentDoctor(1500);
    await db.doctor.update({ where: { id: doc.id }, data: { clinicId: o.clinicId } });
    const day = new Date(dayStr(0) + "T00:00:00Z");
    let slot = 8 * 60;
    const mk = async (status: string, financial?: { priceDzd: number | null; doctorSharePercent: number | null }, date = day) => {
      const t = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
      const s = slot; slot += 15;
      return db.appointment.create({ data: { patientId, doctorId: doc.id, date, startTime: t(s), endTime: t(s + 15), status: status as any, guestFirstName: "ا", guestLastName: "ب", createdBy: "PATIENT",
        ...(financial ? { financial: { create: { ...financial, clinicId: o.clinicId } } } : {}) }, select: { id: true } });
    };
    await mk("COMPLETED", { priceDzd: 2000, doctorSharePercent: 80 });
    await mk("COMPLETED", { priceDzd: 2000, doctorSharePercent: 80 });
    await mk("COMPLETED", { priceDzd: 2125, doctorSharePercent: 85 });
    await mk("COMPLETED", { priceDzd: 1800, doctorSharePercent: null }); // نسبة غير محددة وقتها
    await mk("COMPLETED"); // قبل الميزة بلا لقطة
    await mk("CANCELLED", { priceDzd: 2000, doctorSharePercent: 80 });
    await mk("NO_SHOW", { priceDzd: 2000, doctorSharePercent: 80 });
    await mk("CONFIRMED", { priceDzd: 2000, doctorSharePercent: 80 }, new Date(dayStr(1) + "T00:00:00Z")); // غدًا: لا يُعتمد غيابه تلقائيًا
    await setTerms(o.token, doc.id, { appointmentPriceDzd: 2300, doctorSharePercent: 60 }); // الحاليان لا يغيّران اللقطات
    const docToken = sign({ sub: (await db.doctor.findUniqueOrThrow({ where: { id: doc.id } })).userId, role: "DOCTOR" });
    const dash = await call("GET", "/api/doctor/dashboard", undefined, docToken);
    expect(dash.status).toBe(200);
    const exp = 1600 * 2 + 1806; // 2125*85% = 1806.25 → 1806
    expect(dash.data.clinicEarnings).toMatchObject({ doctorSharePercent: 60, duesTotal: exp, completedWithoutShareTotal: 2 });
    expect(dash.data.estimatedRevenue).toBe(2000 + 2000 + 2125 + 1800 + 2300);
    const rep = await call("GET", `/api/clinics/mine/finance?from=${dayStr(0)}&to=${dayStr(1)}`, undefined, o.token);
    expect(rep.status).toBe(200);
    const row = rep.data.perDoctor.find((d: any) => d.doctorId === doc.id).summary;
    expect(row).toMatchObject({ completedCount: 5, doctorDuesDzd: exp, completedWithoutShare: 2, cancelledCount: 1, noShowCount: 1, pendingCount: 1 });
    expect(rep.data.totals.completedWithoutShare).toBeGreaterThanOrEqual(2);
    expect(rep.data.notes).toContain("تقديرية");
    expect(rep.data.notes).toContain("ليست إثباتًا");
  });
});
