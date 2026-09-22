/**
 * حظر المرضى على PostgreSQL حقيقي عبر HTTP (Express + JWT + الصلاحيات + القيود الحقيقية):
 * صلاحيات الإدارة فقط، رفض الحجز 403 من الخادم مهما تغيّر الطلب، إلغاء الحظر، سلامة المواعيد
 * والبيانات، عدم تكرار الحظر، إعادة الحظر، سجل العمليات، وعدم كشف سبب الحظر للمريض.
 * تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run patientBlocks
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

const PHONE = `05${String(Date.now()).slice(-8)}`;
const BLOCK_MSG = "حسابك محظور حاليًا ولا يمكنك إنشاء حجوزات جديدة. يرجى التواصل مع الإدارة.";

describe.skipIf(!TEST_URL)("حظر المرضى (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let sign: (p: { sub: string; role: any }) => string;
  const tag = `blk${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  let adminToken = "";
  let adminUserId = "";
  let doctorToken = "";
  let assistantToken = "";
  let docA = "";
  let docB = "";
  let patient = { userId: "", patientId: "", token: "", email: "" };
  let other = { userId: "", patientId: "", token: "" };

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined, raw: j };
  };
  const book = (token: string | undefined, extra: Record<string, unknown> = {}, doctorId = docA) =>
    call("POST", "/api/booking", { firstName: "سارة", lastName: "بن يوسف", phone: "0551234567", wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId, ...extra }, token);
  const blockUrl = (pid: string) => `/api/admin/patients/${pid}/block`;
  const unblockUrl = (pid: string) => `/api/admin/patients/${pid}/unblock`;

  async function mkDoctor(i: string) {
    const u = await db.user.create({ data: { email: `${tag}-doc${i}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + i, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 15, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, day) => ({ dayOfWeek: day, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    return { userId: u.id, doctorId: d.id };
  }

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
    adminUserId = admin.id;
    adminToken = sign({ sub: admin.id, role: "ADMIN" });

    const a = await mkDoctor("A");
    const b = await mkDoctor("B");
    docA = a.doctorId;
    docB = b.doctorId;
    doctorToken = sign({ sub: a.userId, role: "DOCTOR" });
    const au = await db.user.create({ data: { email: `${tag}-asst@test.local`, passwordHash: "x", role: "ASSISTANT" } });
    ids.users.push(au.id);
    await db.assistant.create({ data: { userId: au.id, doctorId: docA, firstName: "مساعد", lastName: tag } });
    assistantToken = sign({ sub: au.id, role: "ASSISTANT" });

    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // مريضان حقيقيان عبر التسجيل نفسه (bcrypt + JWT) — لا حقن مباشر.
    const email = `${tag}-p@test.local`;
    const reg = await call("POST", "/api/patient/auth/register", { email, password: "Secret123!", name: "سارة بن يوسف", phone: PHONE });
    expect(reg.status).toBe(201);
    patient = { userId: reg.data.user.id, patientId: reg.data.user.patient.id, token: reg.data.accessToken, email };
    ids.users.push(patient.userId);
    const reg2 = await call("POST", "/api/patient/auth/register", { email: `${tag}-o@test.local`, password: "Secret123!", name: "مريض آخر" });
    other = { userId: reg2.data.user.id, patientId: reg2.data.user.patient.id, token: reg2.data.accessToken };
    ids.users.push(other.userId);
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.patientBlock.deleteMany({ where: { patient: { userId: { in: ids.users } } } });
    await db.assistant.deleteMany({ where: { doctorId: { in: ids.doctors } } });
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

  it("6) مريض عادي يستطيع الحجز (قبل أي حظر)", async () => {
    const r = await book(patient.token);
    expect(r.status).toBe(201);
    const appt = await db.appointment.findUnique({ where: { id: r.data.id } });
    expect(appt!.patientId).toBe(patient.patientId);
  });

  it("2-5) الطبيب والمساعد والمريض وبلا توكن: لا يستطيعون الحظر ولا إلغاءه ولا رؤية القائمة", async () => {
    for (const t of [doctorToken, assistantToken, patient.token, other.token]) {
      expect((await call("POST", blockUrl(patient.patientId), { reason: "x" }, t)).status).toBe(403);
      expect((await call("POST", unblockUrl(patient.patientId), undefined, t)).status).toBe(403);
      expect((await call("GET", "/api/admin/patient-blocks", undefined, t)).status).toBe(403);
    }
    // المريض يحاول حظر نفسه
    expect((await call("POST", blockUrl(patient.patientId), {}, patient.token)).status).toBe(403);
    for (const u of [blockUrl(patient.patientId), unblockUrl(patient.patientId)]) {
      expect((await call("POST", u)).status).toBe(401);
    }
    expect((await call("GET", "/api/admin/patient-blocks")).status).toBe(401);
    expect(await db.patientBlock.count({ where: { patientId: patient.patientId } })).toBe(0);
  });

  it("1+18) المدير يحظر مريضًا: السبب والتاريخ والمسؤول محفوظون + سجل العملية", async () => {
    const before = Date.now();
    const r = await call("POST", blockUrl(patient.patientId), { reason: "  إساءة متكررة  " }, adminToken);
    expect(r.status).toBe(201);
    const row = await db.patientBlock.findFirst({ where: { patientId: patient.patientId } });
    expect(row).toMatchObject({ reason: "إساءة متكررة", blockedBy: adminUserId, activePatientId: patient.patientId, unblockedAt: null });
    expect(row!.blockedAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
    const log = await db.auditLog.findFirst({ where: { action: "BLOCK_PATIENT", entityId: patient.patientId } });
    expect(log).toMatchObject({ userId: adminUserId, entity: "Patient" });
    expect((log!.meta as any).reason).toBe("إساءة متكررة");

    const list = await call("GET", "/api/admin/patient-blocks", undefined, adminToken);
    const item = list.data.items.find((i: any) => i.patientId === patient.patientId);
    expect(item).toMatchObject({ patientName: "سارة بن يوسف", email: patient.email, phone: PHONE, reason: "إساءة متكررة", active: true });
    expect(item.blockedByEmail).toBe(`${tag}-admin@test.local`);
    // بحث بالاسم وبالبريد
    expect((await call("GET", "/api/admin/patient-blocks?q=" + encodeURIComponent("سارة"), undefined, adminToken)).data.items.some((i: any) => i.patientId === patient.patientId)).toBe(true);
    expect((await call("GET", `/api/admin/patient-blocks?q=${tag}-p@`, undefined, adminToken)).data.items).toHaveLength(1);
  });

  it("16) لا حظر مكرر: حظر ثانٍ → 409، وعشرة طلبات متزامنة لا تنشئ سجلًا إضافيًا", async () => {
    expect((await call("POST", blockUrl(patient.patientId), {}, adminToken)).status).toBe(409);
    const burst = await Promise.all(Array.from({ length: 10 }, () => call("POST", blockUrl(patient.patientId), {}, adminToken)));
    expect(burst.every((b) => b.status === 409)).toBe(true);
    expect(await db.patientBlock.count({ where: { patientId: patient.patientId } })).toBe(1);
    // معرّف غير موجود / غير صالح
    expect((await call("POST", blockUrl("00000000-0000-4000-8000-000000000000"), {}, adminToken)).status).toBe(404);
    expect((await call("POST", blockUrl("not-a-uuid"), {}, adminToken)).status).toBe(400);
  });

  it("7-11) المريض المحظور لا يحجز مهما غيّر الطلب: 403 برسالة واضحة ولا موعد جديد", async () => {
    const count = () => db.appointment.count({ where: { patientId: patient.patientId } });
    const before = await count();

    const r = await book(patient.token);
    expect(r.status).toBe(403);
    expect(r.message).toBe(BLOCK_MSG);
    // patientId لمريض آخر غير محظور في الجسم (9)
    expect((await book(patient.token, { patientId: other.patientId })).status).toBe(403);
    // تغيير بيانات الطلب: اسم/هاتف/تاريخ/وقت/طبيب آخر (11 + صفحة طبيب مختلفة)
    expect((await book(patient.token, { firstName: "اسم", lastName: "مختلف", phone: "0661234567" })).status).toBe(403);
    expect((await book(patient.token, { date: "2030-01-01", startTime: "10:00" })).status).toBe(403);
    expect((await book(patient.token, {}, docB)).status).toBe(403);
    // إعادة تسجيل الدخول: جلسة جديدة صحيحة ما زالت محظورة (10)
    const login = await call("POST", "/api/patient/auth/login", { email: patient.email, password: "Secret123!" });
    expect(login.status).toBe(200);
    expect((await book(login.data.accessToken)).status).toBe(403);
    // المسار الآخر لإنشاء موعد (POST /api/appointments) محمي أيضًا
    const alt = await call("POST", "/api/appointments", { doctorId: docA, date: "2030-01-01", startTime: "10:00", type: "IN_PERSON" }, patient.token);
    expect(alt.status).toBe(403);
    expect(await count()).toBe(before);

    // المريض الآخر غير المحظور يحجز عاديًا
    expect((await book(other.token)).status).toBe(201);
  });

  it("المريض المحظور يدخل حسابه ويرى مواعيده؛ يعرف أنه محظور دون كشف السبب أو المسؤول", async () => {
    const login = await call("POST", "/api/patient/auth/login", { email: patient.email, password: "Secret123!" });
    expect(login.status).toBe(200);
    expect(login.data.user.isBlocked).toBe(true);
    const me = await call("GET", "/api/patient/auth/me", undefined, login.data.accessToken);
    expect(me.status).toBe(200);
    expect(me.data.isBlocked).toBe(true);
    const body = JSON.stringify(me.raw) + JSON.stringify(login.raw);
    expect(body).not.toContain("إساءة متكررة");
    expect(body).not.toContain(adminUserId);
    const mine = await call("GET", "/api/patient/account/appointments", undefined, login.data.accessToken);
    expect(mine.status).toBe(200);
    expect(mine.data.length).toBeGreaterThanOrEqual(1);
    // المريض الآخر غير محظور
    expect((await call("GET", "/api/patient/auth/me", undefined, other.token)).data.isBlocked).toBe(false);
  });

  it("الحظر لا يغيّر المواعيد الموجودة ولا الطابور/LATE/NO_SHOW/التذكيرات", async () => {
    const appts = await db.appointment.findMany({ where: { patientId: patient.patientId }, orderBy: { createdAt: "asc" } });
    expect(appts.length).toBeGreaterThanOrEqual(1);
    expect(appts.every((a) => a.status === "PENDING" || a.status === "CONFIRMED")).toBe(true);
    expect(appts.every((a) => a.deferredCount === 0)).toBe(true);
  });

  it("12-15) المدير يلغي الحظر؛ السجل يبقى؛ المريض يحجز من جديد؛ المواعيد والبيانات كما هي", async () => {
    const apptsBefore = await db.appointment.findMany({ where: { patientId: patient.patientId }, orderBy: { id: "asc" } });
    const patientBefore = await db.patient.findUnique({ where: { id: patient.patientId }, include: { user: true } });

    const r = await call("POST", unblockUrl(patient.patientId), undefined, adminToken);
    expect(r.status).toBe(200);
    const rows = await db.patientBlock.findMany({ where: { patientId: patient.patientId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ activePatientId: null, unblockedBy: adminUserId, reason: "إساءة متكررة", blockedBy: adminUserId });
    expect(rows[0].unblockedAt).toBeInstanceOf(Date);
    expect(await db.auditLog.count({ where: { action: "UNBLOCK_PATIENT", entityId: patient.patientId, userId: adminUserId } })).toBe(1);
    // إلغاء مرة ثانية → 409 (غير محظور)
    expect((await call("POST", unblockUrl(patient.patientId), undefined, adminToken)).status).toBe(409);
    // القائمة السارية لا تعرضه، وسجل «الكل» يعرضه بحالة مُلغى
    expect((await call("GET", "/api/admin/patient-blocks", undefined, adminToken)).data.items.some((i: any) => i.patientId === patient.patientId)).toBe(false);
    const hist = (await call("GET", "/api/admin/patient-blocks?status=all", undefined, adminToken)).data.items.find((i: any) => i.patientId === patient.patientId);
    expect(hist).toMatchObject({ active: false, unblockedByEmail: `${tag}-admin@test.local` });

    // 14+15: المواعيد القديمة وبيانات المريض لم تتغيّر
    expect(await db.appointment.findMany({ where: { patientId: patient.patientId }, orderBy: { id: "asc" } })).toEqual(apptsBefore);
    const patientAfter = await db.patient.findUnique({ where: { id: patient.patientId }, include: { user: true } });
    expect({ ...patientAfter, user: { ...patientAfter!.user, updatedAt: null } }).toEqual({ ...patientBefore, user: { ...patientBefore!.user, updatedAt: null } });

    // 13: يستطيع الحجز والدخول
    const login = await call("POST", "/api/patient/auth/login", { email: patient.email, password: "Secret123!" });
    expect(login.data.user.isBlocked).toBe(false);
    expect((await book(login.data.accessToken)).status).toBe(201);
  });

  it("17) إعادة الحظر بعد الإلغاء: سجل جديد، والقديم محفوظ، والحجز يُرفض مجددًا", async () => {
    const r = await call("POST", blockUrl(patient.patientId), {}, adminToken);
    expect(r.status).toBe(201);
    const rows = await db.patientBlock.findMany({ where: { patientId: patient.patientId }, orderBy: { blockedAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].activePatientId).toBeNull();
    expect(rows[1]).toMatchObject({ activePatientId: patient.patientId, reason: null, unblockedAt: null });
    expect((await book(patient.token)).status).toBe(403);
    // إلغاء متزامن ×5 → واحد ينجح فقط
    const burst = await Promise.all(Array.from({ length: 5 }, () => call("POST", unblockUrl(patient.patientId), undefined, adminToken)));
    expect(burst.filter((b) => b.status === 200)).toHaveLength(1);
    expect(burst.filter((b) => b.status === 409)).toHaveLength(4);
  });

  it("IDOR: حظر مريض لا يؤثر على غيره، ومسار الحظر يستعمل المعرّف في الرابط للإدارة فقط", async () => {
    await call("POST", blockUrl(other.patientId), {}, adminToken);
    expect((await book(other.token)).status).toBe(403);
    expect((await book(patient.token)).status).toBe(201);
    await call("POST", unblockUrl(other.patientId), undefined, adminToken);
    expect((await book(other.token)).status).toBe(201);
  });

  it("قائمة المستخدمين في الإدارة تُظهر حالة الحظر السارية للمريض", async () => {
    await call("POST", blockUrl(patient.patientId), {}, adminToken);
    const users = await call("GET", `/api/admin/users?role=PATIENT&q=${tag}-p@`, undefined, adminToken);
    const u = users.data.items.find((x: any) => x.id === patient.userId);
    expect(u.patient.blocks).toHaveLength(1);
    expect(JSON.stringify(users.raw)).not.toContain("passwordHash");
    await call("POST", unblockUrl(patient.patientId), undefined, adminToken);
    const again = await call("GET", `/api/admin/users?role=PATIENT&q=${tag}-p@`, undefined, adminToken);
    expect(again.data.items.find((x: any) => x.id === patient.userId).patient.blocks).toHaveLength(0);
  });
});
