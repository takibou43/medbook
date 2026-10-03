/**
 * أسعار الأطباء ونسبهم داخل العيادات (PostgreSQL حقيقي عبر HTTP):
 * - المدير يحدد السعر والنسبة لكل طبيب مستقلًا، والمريض يرى السعر فقط.
 * - اللقطة المالية تُحفظ مع الموعد ولا يغيّرها تعديل الشروط لاحقًا.
 * - مستحقات الطبيب تُحسب للمكتمل فقط، والملغى لا يدخل.
 * - الطبيب يرى شروطه هو، ولا يرى زميله.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run clinicFinance
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}
const dayStr = (n: number) => {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n)).toISOString().slice(0, 10);
};

describe.skipIf(!TEST_URL)("أسعار ونسب أطباء العيادة (PostgreSQL حقيقي)", () => {
  let server: http.Server; let base: string; let db: PrismaClient;
  let sign: typeof import("../../src/utils/jwt").signAccessToken;
  const tag = `cf${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[], clinics: [] as string[] };
  let seq = 0;
  let clinicId = ""; let ownerToken = ""; let otherOwnerToken = "";
  let docA = { id: "", token: "" }; let docB = { id: "", token: "" };
  let patient = { token: "" };

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, text: JSON.stringify(j) };
  };
  async function mkDoctor(inClinic: boolean, fee: number) {
    const n = ++seq;
    const u = await db.user.create({ data: { email: `${tag}-d${n}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + n, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 15, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", consultationFee: fee,
        clinicId: inClinic ? clinicId : null,
        schedules: { create: Array.from({ length: 7 }, (_, day) => ({ dayOfWeek: day, startTime: "09:00", endTime: "12:00" })) },
      },
    });
    ids.users.push(u.id); ids.doctors.push(d.id);
    return { id: d.id, token: sign({ sub: u.id, role: "DOCTOR" }) };
  }
  const book = (doctorId: string, date: string) => call("POST", "/api/booking", {
    firstName: "سارة", lastName: "بن يوسف", phone: "0551234567", wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId, date,
  }, patient.token);
  const snapshot = (appointmentId: string) => db.appointmentFinancial.findUnique({ where: { appointmentId } });
  const setTerms = (doctorId: string, body: unknown, token = ownerToken) => call("PATCH", `/api/clinics/mine/doctors/${doctorId}/terms`, body, token);

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL; process.env.RATE_LIMIT_MAX = "1000000"; process.env.REMINDERS_ENABLED = "false";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const future = new Date(Date.now() + 90 * 86400000);
    const mkOwner = async (label: string) => {
      const u = await db.user.create({ data: { email: `${tag}-${label}@test.local`, passwordHash: "x", role: "CLINIC_OWNER" } });
      const clinic = await db.clinic.create({ data: {
        nameAr: `عيادة ${label} ${tag}`, address: "شارع الاختبار", wilayaId: w.id, cityId: c.id, ownerId: u.id,
        verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", subscriptionExpiresAt: future, paidDoctorCount: 5,
      } });
      ids.users.push(u.id); ids.clinics.push(clinic.id);
      return { token: sign({ sub: u.id, role: "CLINIC_OWNER" }), clinicId: clinic.id };
    };
    const o1 = await mkOwner("one"); const o2 = await mkOwner("two");
    ownerToken = o1.token; clinicId = o1.clinicId; otherOwnerToken = o2.token;
    docA = await mkDoctor(true, 1500); docB = await mkDoctor(true, 1800);
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const reg = await call("POST", "/api/patient/auth/register", { email: `${tag}-p@test.local`, password: "Secret123!", name: "مريض اختبار", phone: `07${String(Date.now()).slice(-8)}` });
    expect(reg.status).toBe(201);
    ids.users.push(reg.data.user.id); patient = { token: reg.data.accessToken };
  }, 60000);

  afterAll(async () => {
    server?.close();
    if (!db) return;
    await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.clinicDoctorTerms.deleteMany({ where: { clinicId: { in: ids.clinics } } });
    await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: ids.doctors } } });
    await db.clinic.deleteMany({ where: { id: { in: ids.clinics } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: ids.users } } });
    await db.patient.deleteMany({ where: { userId: { in: ids.users } } });
    await db.user.deleteMany({ where: { id: { in: ids.users } } });
    await db.specialty.deleteMany({ where: { id: ids.specialty } });
    await db.city.deleteMany({ where: { id: ids.city } });
    await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
    await db.$disconnect();
  });

  it("الأطباء الحاليون: السعر القائم ونسبة غير محددة، ولا لقطة بنسبة", async () => {
    const mine = await call("GET", "/api/clinics/mine", undefined, ownerToken);
    const a = mine.data.doctors.find((d: any) => d.id === docA.id);
    expect(a.terms).toEqual({ appointmentPriceDzd: 1500, priceSource: "DOCTOR_DEFAULT", doctorSharePercent: null, clinicSharePercent: null });
    const r = await book(docA.id, dayStr(1));
    expect(r.status).toBe(201);
    expect(await snapshot(r.data.id)).toMatchObject({ priceDzd: 1500, doctorSharePercent: null, clinicId });
  });

  it("المدير يحدد لكل طبيب سعره ونسبته، ولا تتأثر أسعاره خارج العيادة", async () => {
    expect((await setTerms(docA.id, { appointmentPriceDzd: 2000, doctorSharePercent: 80 })).data).toMatchObject({ clinicSharePercent: 20 });
    expect((await setTerms(docB.id, { appointmentPriceDzd: 2500, doctorSharePercent: 85 })).data).toMatchObject({ clinicSharePercent: 15 });
    expect((await db.doctor.findUniqueOrThrow({ where: { id: docA.id } })).consultationFee).toBe(1500);
    expect((await db.doctor.findUniqueOrThrow({ where: { id: docB.id } })).consultationFee).toBe(1800);
  });

  it("المريض يرى سعر العيادة فقط بلا أي نسبة", async () => {
    const r = await call("GET", `/api/doctors/${docA.id}`);
    expect(r.status).toBe(200);
    expect(r.data.consultationFee).toBe(2000);
    expect(r.text).not.toMatch(/SharePercent|clinicTerms/);
    const list = await call("GET", `/api/clinics/${clinicId}`);
    expect(list.text).not.toMatch(/SharePercent|clinicTerms/);
    expect(list.data.doctors.find((d: any) => d.id === docB.id).consultationFee).toBe(2500);
  });

  it("استجابة الحجز للمريض لا تحمل النسبة، واللقطة تحفظ السعر والنسبة", async () => {
    const r = await book(docA.id, dayStr(2));
    expect(r.status).toBe(201);
    expect(r.text).not.toMatch(/SharePercent|financial/);
    expect(await snapshot(r.data.id)).toMatchObject({ priceDzd: 2000, doctorSharePercent: 80, clinicId });
  });

  it("تعديل السعر والنسبة لا يغيّر لقطة موعد سابق، والموعد الجديد يأخذ الجديد", async () => {
    const old = await book(docA.id, dayStr(3));
    expect(await snapshot(old.data.id)).toMatchObject({ priceDzd: 2000, doctorSharePercent: 80 });
    expect((await setTerms(docA.id, { appointmentPriceDzd: 3000, doctorSharePercent: 70 })).status).toBe(200);
    expect(await snapshot(old.data.id)).toMatchObject({ priceDzd: 2000, doctorSharePercent: 80 });
    const fresh = await book(docA.id, dayStr(4));
    expect(await snapshot(fresh.data.id)).toMatchObject({ priceDzd: 3000, doctorSharePercent: 70 });
  });

  it("المستحقات للمكتمل فقط؛ الملغى والمعلّق لا يدخلان، والتقرير يطابق اللقطات", async () => {
    const rows = await db.appointment.findMany({ where: { doctorId: docA.id }, include: { financial: true }, orderBy: { date: "asc" } });
    const withSnap = rows.filter(r => r.financial?.doctorSharePercent != null);
    expect(withSnap.length).toBeGreaterThanOrEqual(3);
    await db.appointment.update({ where: { id: withSnap[0].id }, data: { status: "COMPLETED" } });
    await db.appointment.update({ where: { id: withSnap[1].id }, data: { status: "COMPLETED" } });
    await db.appointment.update({ where: { id: withSnap[2].id }, data: { status: "CANCELLED", activeSlot: null } });
    const from = dayStr(0); const to = dayStr(10);
    const report = await call("GET", `/api/clinics/mine/finance?from=${from}&to=${to}`, undefined, ownerToken);
    expect(report.status).toBe(200);
    const row = report.data.perDoctor.find((d: any) => d.doctorId === docA.id);
    const expectDues = (p: number | null, s: number | null) => (p != null && s != null ? Math.floor((p * s + 50) / 100) : 0);
    const expected = [withSnap[0], withSnap[1]].reduce((n, r) => n + expectDues(r.financial!.priceDzd, r.financial!.doctorSharePercent), 0);
    expect(row.summary.completedCount).toBe(2);
    expect(row.summary.cancelledCount).toBe(1);
    expect(row.summary.doctorDuesDzd).toBe(expected);
    expect(row.summary.doctorDuesDzd + row.summary.clinicShareDzd).toBe(row.summary.grossDzd);
  });

  it("الطبيب يرى شروطه فقط، لا شروط زميله", async () => {
    const a = await call("GET", "/api/doctor/clinic-terms", undefined, docA.token);
    const b = await call("GET", "/api/doctor/clinic-terms", undefined, docB.token);
    expect(a.data).toMatchObject({ inClinic: true, appointmentPriceDzd: 3000, doctorSharePercent: 70, clinicSharePercent: 30 });
    expect(b.data).toMatchObject({ appointmentPriceDzd: 2500, doctorSharePercent: 85, clinicSharePercent: 15 });
    expect(a.text).not.toContain("85"); expect(b.text).not.toMatch(/"doctorSharePercent":70/);
    const stats = await call("GET", "/api/doctor/dashboard", undefined, docB.token);
    expect(stats.data.clinicEarnings).toMatchObject({ doctorSharePercent: 85 });
  });

  it("لا يستطيع طبيب أو مدير عيادة أخرى أو مريض تعديل الشروط، والقيم غير الصالحة تُرفض", async () => {
    expect((await setTerms(docA.id, { doctorSharePercent: 10 }, docA.token)).status).toBeGreaterThanOrEqual(400);
    expect((await setTerms(docA.id, { doctorSharePercent: 10 }, otherOwnerToken)).status).toBe(404);
    expect((await setTerms(docA.id, { doctorSharePercent: 10 }, patient.token)).status).toBe(403);
    for (const bad of [{ doctorSharePercent: 101 }, { doctorSharePercent: -1 }, { appointmentPriceDzd: -1 }, { appointmentPriceDzd: 10.5 }, { clinicSharePercent: 20 }])
      expect((await setTerms(docA.id, bad)).status).toBe(400);
    expect((await db.clinicDoctorTerms.findUniqueOrThrow({ where: { doctorId: docA.id } })).doctorSharePercent).toBe(70);
  });

  it("الطبيب لا يعدّل سعره داخل العيادة، ودعوة بشروط تُحفظ مع الدعوة", async () => {
    const res = await call("PATCH", "/api/doctor/profile", { consultationFee: 99999 }, docA.token);
    expect(res.status).toBe(403);
    const inv = await call("POST", "/api/clinics/mine/invites", { email: `${tag}-inv@test.local`, appointmentPriceDzd: 2200, doctorSharePercent: 75 }, ownerToken);
    expect(inv.status).toBe(201);
    const stored = await db.clinicDoctorInvite.findFirstOrThrow({ where: { clinicId, email: `${tag}-inv@test.local` } });
    expect(stored).toMatchObject({ termsPriceDzd: 2200, termsDoctorSharePercent: 75 });
    expect((await call("POST", "/api/clinics/mine/invites", { email: `${tag}-inv2@test.local`, doctorSharePercent: 150 }, ownerToken)).status).toBe(400);
  });
});
