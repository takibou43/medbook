/**
 * الحظر التلقائي بعد تكرار الغياب (3 × NO_SHOW خلال 7 أيام) على PostgreSQL حقيقي عبر HTTP:
 * العدّ داخل النافذة فقط، الحالات التي لا تُحتسب (LATE/CANCELLED/COMPLETED)، سجل حظر واحد،
 * رفض الحجز 403، رفع الحظر من الإدارة، إعادة الحظر بعد غيابات جديدة، والتزامن (طبيب + مساعد
 * + الاعتماد التلقائي عند الإغلاق). تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run autoBlock
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

const BLOCK_MSG = "حسابك محظور حاليًا ولا يمكنك إنشاء حجوزات جديدة. يرجى التواصل مع الإدارة.";

describe.skipIf(!TEST_URL)("الحظر التلقائي بعد تكرار الغياب (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let sign: (p: { sub: string; role: any }) => string;
  let today: Date;
  const tag = `ab${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  let adminToken = "";
  let adminUserId = "";
  let doctorToken = "";
  let assistantToken = "";
  let docA = "";
  let docSweep = { doctorId: "", token: "", asstToken: "" };
  let slotSeq = 0;
  let patientSeq = 0;

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined, raw: j };
  };
  const day = (offset: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
  };
  // أوقات فريدة قصيرة (دقيقة واحدة) في آخر ساعات اليوم حتى لا تحجب مواعيد الحجز الآلي.
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const nextSlot = () => hhmm(20 * 60 + (slotSeq++ % 238));
  const endOf = (start: string) => { const [h, m] = start.split(":").map(Number); return hhmm(h * 60 + m + 1); };
  const book = (token: string, extra: Record<string, unknown> = {}) =>
    call("POST", "/api/booking", { firstName: "سارة", lastName: "بن يوسف", phone: "0551234567", wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId: docA, ...extra }, token);
  const noShow = (apptId: string, token = doctorToken) => call("PATCH", `/api/appointments/${apptId}`, { status: "NO_SHOW" }, token);
  const blocksOf = (patientId: string) => db.patientBlock.findMany({ where: { patientId }, orderBy: { blockedAt: "asc" } });
  const activeOf = (patientId: string) => db.patientBlock.count({ where: { activePatientId: patientId } });

  async function mkDoctor(i: string) {
    const u = await db.user.create({ data: { email: `${tag}-doc${i}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + i, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 15, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, dow) => ({ dayOfWeek: dow, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    return { userId: u.id, doctorId: d.id };
  }
  async function mkAssistant(doctorId: string, i: string) {
    const au = await db.user.create({ data: { email: `${tag}-asst${i}@test.local`, passwordHash: "x", role: "ASSISTANT" } });
    ids.users.push(au.id);
    await db.assistant.create({ data: { userId: au.id, doctorId, firstName: "مساعد", lastName: tag } });
    return sign({ sub: au.id, role: "ASSISTANT" });
  }
  /** مريض حقيقي عبر التسجيل (bcrypt + JWT). */
  async function mkPatient() {
    const n = ++patientSeq;
    const email = `${tag}-p${n}@test.local`;
    const phone = `07${String(Date.now() + n).slice(-8)}`;
    const reg = await call("POST", "/api/patient/auth/register", { email, password: "Secret123!", name: `مريض ${n}`, phone });
    expect(reg.status).toBe(201);
    ids.users.push(reg.data.user.id);
    return { userId: reg.data.user.id as string, patientId: reg.data.user.patient.id as string, token: reg.data.accessToken as string, email, phone };
  }
  /** موعد مؤكَّد (الحالة التي يُضغط عليها «لم يحضر») بتاريخ نسبي لليوم. */
  async function mkAppt(patientId: string, offset: number, status: any = "CONFIRMED", doctorId = docA) {
    const startTime = nextSlot();
    const a = await db.appointment.create({
      data: { patientId, doctorId, date: day(offset), startTime, endTime: endOf(startTime), status },
    });
    return a.id;
  }

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    process.env.REMINDERS_ENABLED = "false";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const { algeriaTodayUTCMidnight } = await import("../../src/lib/slots");
    today = algeriaTodayUTCMidnight();
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });

    const admin = await db.user.create({ data: { email: `${tag}-admin@test.local`, passwordHash: "x", role: "ADMIN" } });
    ids.users.push(admin.id);
    adminUserId = admin.id;
    adminToken = sign({ sub: admin.id, role: "ADMIN" });

    const a = await mkDoctor("A");
    docA = a.doctorId;
    doctorToken = sign({ sub: a.userId, role: "DOCTOR" });
    assistantToken = await mkAssistant(docA, "A");
    const sw = await mkDoctor("S");
    docSweep = { doctorId: sw.doctorId, token: sign({ sub: sw.userId, role: "DOCTOR" }), asstToken: await mkAssistant(sw.doctorId, "S") };

    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    const patientIds = (await db.patient.findMany({ where: { userId: { in: ids.users } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { entityId: { in: patientIds } }] } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.smsLog.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointmentLateEvent.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointment.deleteMany({ where: { OR: [{ doctorId: { in: ids.doctors } }, { patientId: { in: patientIds } }] } });
    await db.patientBlock.deleteMany({ where: { patientId: { in: patientIds } } });
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

  // ---------------- الغيابات ----------------

  let p1: Awaited<ReturnType<typeof mkPatient>>;
  it("1-3) غياب أول وثانٍ → لا حظر؛ الغياب الثالث خلال 7 أيام → حظر تلقائي (مثال 20/22/25)", async () => {
    p1 = await mkPatient();
    const a1 = await mkAppt(p1.patientId, -5); // «20 سبتمبر»
    const a2 = await mkAppt(p1.patientId, -3); // «22 سبتمبر»
    const a3 = await mkAppt(p1.patientId, 0); //  «25 سبتمبر»

    expect((await noShow(a1)).status).toBe(200);
    expect(await blocksOf(p1.patientId)).toHaveLength(0);
    expect((await book(p1.token)).status).toBe(201);

    expect((await noShow(a2, assistantToken)).status).toBe(200);
    expect(await blocksOf(p1.patientId)).toHaveLength(0);

    expect((await noShow(a3)).status).toBe(200);
    const rows = await blocksOf(p1.patientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      activePatientId: p1.patientId,
      blockType: "AUTOMATIC",
      noShowCount: 3,
      reason: "حظر تلقائي بسبب 3 غيابات خلال 7 أيام",
      blockedBy: null,
      unblockedAt: null,
    });
    // سجل العمليات: BLOCK_PATIENT من النظام، بلا معلومات طبية ولا هوية الطبيب
    const logs = await db.auditLog.findMany({ where: { action: "BLOCK_PATIENT", entityId: p1.patientId } });
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBeNull();
    expect(logs[0].meta).toMatchObject({ blockType: "AUTOMATIC", noShowCount: 3, windowDays: 7, limit: 3, blockId: rows[0].id });
    expect(JSON.stringify(logs[0].meta)).not.toMatch(/doctor|notes|docA/i);
  });

  it("4) ثلاثة غيابات أحدها أقدم من 7 أيام (قبل 7 و8 أيام) → لا حظر؛ حدّ النافذة: قبل 6 أيام يُحتسب", async () => {
    const p = await mkPatient();
    const old8 = await mkAppt(p.patientId, -8);
    const old7 = await mkAppt(p.patientId, -7);
    const r1 = await mkAppt(p.patientId, -1);
    const r2 = await mkAppt(p.patientId, 0);
    for (const id of [old8, old7, r1, r2]) expect((await noShow(id)).status).toBe(200);
    expect(await blocksOf(p.patientId)).toHaveLength(0); // داخل النافذة: 2 فقط
    const edge = await mkAppt(p.patientId, -6);
    expect((await noShow(edge)).status).toBe(200);
    expect(await blocksOf(p.patientId)).toHaveLength(1); // قبل 6 أيام = اليوم السابع داخل النافذة
  });

  it("5) ثلاثة غيابات تاريخية متباعدة أكثر من 7 أيام → لا حظر (لا مجموع منذ إنشاء الحساب)", async () => {
    const p = await mkPatient();
    for (const off of [-30, -20, -10, 0]) expect((await noShow(await mkAppt(p.patientId, off))).status).toBe(200);
    expect(await db.appointment.count({ where: { patientId: p.patientId, status: "NO_SHOW" } })).toBe(4);
    expect(await blocksOf(p.patientId)).toHaveLength(0);
    expect((await book(p.token)).status).toBe(201);
  });

  it("6-8) LATE وCANCELLED وCOMPLETED لا تُحتسب غيابًا؛ منطق التأخير في الطابور لم يتغيّر", async () => {
    const p = await mkPatient();
    for (const off of [-2, -1]) expect((await noShow(await mkAppt(p.patientId, off))).status).toBe(200);

    // LATE عبر زر «متأخر»: تأخير أول = عقوبة مريضين، ثم تأخير لاحق = 4 — ويبقى LATE لا NO_SHOW
    const lateId = await mkAppt(p.patientId, 0);
    const l1 = await call("POST", `/api/appointments/${lateId}/late`, undefined, doctorToken);
    expect(l1.status).toBe(200);
    let late = await db.appointment.findUnique({ where: { id: lateId } });
    expect(late).toMatchObject({ status: "LATE", deferredCount: 1, skipCredits: 2 });
    // المساعد يسجّل متأخرًا آخر، ثم تأخير لاحق لنفس الموعد بعد إعادة ندائه = عقوبة 4
    const late2 = await mkAppt(p.patientId, 0);
    expect((await call("POST", `/api/appointments/${late2}/late`, undefined, assistantToken)).status).toBe(200);
    expect((await call("POST", `/api/appointments/${late2}/call`, undefined, assistantToken)).status).toBe(200);
    expect((await call("POST", `/api/appointments/${late2}/late`, undefined, assistantToken)).status).toBe(200);
    expect(await db.appointment.findUnique({ where: { id: late2 } })).toMatchObject({ status: "LATE", deferredCount: 2, skipCredits: 4 });
    expect((await db.appointment.findUnique({ where: { id: late2 } }))!.status).toBe("LATE");
    expect(await blocksOf(p.patientId)).toHaveLength(0);

    // CANCELLED وCOMPLETED
    const c = await mkAppt(p.patientId, 0);
    expect((await call("PATCH", `/api/appointments/${c}`, { status: "CANCELLED" }, doctorToken)).status).toBe(200);
    const done = await mkAppt(p.patientId, 0);
    expect((await call("PATCH", `/api/appointments/${done}`, { status: "COMPLETED" }, doctorToken)).status).toBe(200);
    // حالات أخرى موجودة في النافذة: PENDING / CONFIRMED / IN_PROGRESS
    await mkAppt(p.patientId, 0, "PENDING");
    await mkAppt(p.patientId, 0, "CONFIRMED");
    await mkAppt(p.patientId, 0, "IN_PROGRESS");

    // غياب آخر حقيقي يعيد التقييم: العدد 3 الآن (لا 8) → حظر بعدد 3 بالضبط
    expect(await blocksOf(p.patientId)).toHaveLength(0);
    expect((await noShow(await mkAppt(p.patientId, 0))).status).toBe(200);
    const rows = await blocksOf(p.patientId);
    expect(rows).toHaveLength(1);
    expect(rows[0].noShowCount).toBe(3);
    late = await db.appointment.findUnique({ where: { id: lateId } });
    expect(late!.status).toBe("LATE"); // الحظر لا يلمس المواعيد الموجودة
  });

  // ---------------- الحظر ----------------

  it("9-10) غياب رابع لمريض محظور تلقائيًا لا ينشئ سجلًا جديدًا — حظر نشط واحد فقط", async () => {
    expect((await noShow(await mkAppt(p1.patientId, 0))).status).toBe(200);
    expect((await noShow(await mkAppt(p1.patientId, -1), assistantToken)).status).toBe(200);
    expect(await blocksOf(p1.patientId)).toHaveLength(1);
    expect(await activeOf(p1.patientId)).toBe(1);
    expect(await db.auditLog.count({ where: { action: "BLOCK_PATIENT", entityId: p1.patientId } })).toBe(1);
    // والحظر اليدوي فوق التلقائي → 409 لا سجل ثانٍ
    expect((await call("POST", `/api/admin/patients/${p1.patientId}/block`, {}, adminToken)).status).toBe(409);
    expect(await blocksOf(p1.patientId)).toHaveLength(1);
  });

  it("11-13) المحظور تلقائيًا لا يحجز (403 ولا موعد)؛ لا الطبيب ولا تغيير patientId يتجاوزان الحظر", async () => {
    const other = await mkPatient();
    const count = () => db.appointment.count({ where: { patientId: p1.patientId } });
    const before = await count();

    const r = await book(p1.token);
    expect(r.status).toBe(403);
    expect(r.message).toBe(BLOCK_MSG);
    expect((await book(p1.token, { patientId: other.patientId })).status).toBe(403);
    expect((await book(p1.token, { phone: "0661234567", firstName: "آخر" })).status).toBe(403);
    expect((await call("POST", "/api/appointments", { doctorId: docA, date: "2030-01-01", startTime: "10:00", type: "IN_PERSON" }, p1.token)).status).toBe(403);
    const relog = await call("POST", "/api/patient/auth/login", { email: p1.email, password: "Secret123!" });
    expect(relog.data.user.isBlocked).toBe(true);
    expect((await book(relog.data.accessToken)).status).toBe(403);

    // الطبيب والمساعد: لا يحجزان باسمه ولا يرفعان الحظر
    for (const t of [doctorToken, assistantToken]) {
      expect((await book(t, { patientId: p1.patientId })).status).toBe(403);
      expect((await call("POST", "/api/appointments", { doctorId: docA, date: "2030-01-01", startTime: "10:00", type: "IN_PERSON", patientId: p1.patientId }, t)).status).toBe(403);
      expect((await call("POST", `/api/admin/patients/${p1.patientId}/unblock`, undefined, t)).status).toBe(403);
    }
    expect(await count()).toBe(before);
    expect(await activeOf(p1.patientId)).toBe(1);
    // المريض الآخر غير متأثر
    expect((await book(other.token)).status).toBe(201);
  });

  it("الإدارة: المحظور تلقائيًا يظهر في «المرضى المحظورون» بالنوع والسبب وعدد الغيابات، والبحث بالهاتف يعمل", async () => {
    const list = await call("GET", "/api/admin/patient-blocks", undefined, adminToken);
    expect(list.status).toBe(200);
    const item = list.data.items.find((i: any) => i.patientId === p1.patientId);
    expect(item).toMatchObject({
      patientName: "مريض 1", email: p1.email, phone: p1.phone, active: true,
      blockType: "AUTOMATIC", noShowCount: 3, reason: "حظر تلقائي بسبب 3 غيابات خلال 7 أيام", blockedByEmail: null,
    });
    expect(item.blockedAt).toBeTruthy();
    const byPhone = await call("GET", `/api/admin/patient-blocks?q=${p1.phone}`, undefined, adminToken);
    expect(byPhone.data.items.map((i: any) => i.patientId)).toEqual([p1.patientId]);
    // الحظر اليدوي القديم يبقى MANUAL
    const m = await mkPatient();
    expect((await call("POST", `/api/admin/patients/${m.patientId}/block`, { reason: "يدوي" }, adminToken)).status).toBe(201);
    expect((await blocksOf(m.patientId))[0]).toMatchObject({ blockType: "MANUAL", noShowCount: null, blockedBy: adminUserId });
    await call("POST", `/api/admin/patients/${m.patientId}/unblock`, undefined, adminToken);
  });

  // ---------------- رفع الحظر ----------------

  it("14-17) الإدارة ترفع الحظر التلقائي؛ المريض يحجز؛ السجل والغيابات والمواعيد محفوظة؛ لا إعادة حظر بدون غياب جديد", async () => {
    const apptsBefore = await db.appointment.findMany({ where: { patientId: p1.patientId }, orderBy: { id: "asc" } });
    const noShowsBefore = apptsBefore.filter((a) => a.status === "NO_SHOW").length;
    expect(noShowsBefore).toBe(5);

    const r = await call("POST", `/api/admin/patients/${p1.patientId}/unblock`, undefined, adminToken);
    expect(r.status).toBe(200);
    const rows = await blocksOf(p1.patientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ activePatientId: null, unblockedBy: adminUserId, blockType: "AUTOMATIC", noShowCount: 3 });
    expect(rows[0].unblockedAt).toBeInstanceOf(Date);
    const log = await db.auditLog.findFirst({ where: { action: "UNBLOCK_PATIENT", entityId: p1.patientId } });
    expect(log).toMatchObject({ userId: adminUserId });
    expect((log!.meta as any).blockType).toBe("AUTOMATIC");

    // سجل «الكل»: النوع + من رفع ومتى
    const hist = (await call("GET", "/api/admin/patient-blocks?status=all", undefined, adminToken)).data.items.find((i: any) => i.patientId === p1.patientId);
    expect(hist).toMatchObject({ active: false, blockType: "AUTOMATIC", unblockedByEmail: `${tag}-admin@test.local` });
    expect(hist.unblockedAt).toBeTruthy();

    // الغيابات والمواعيد لم تُحذف ولم تتغيّر
    expect(await db.appointment.findMany({ where: { patientId: p1.patientId }, orderBy: { id: "asc" } })).toEqual(apptsBefore);

    // لا حلقة: فتح قائمة الطبيب (تشغيل الاعتماد التلقائي) لا يعيد الحظر دون غياب جديد
    expect((await call("GET", "/api/appointments", undefined, doctorToken)).status).toBe(200);
    expect(await activeOf(p1.patientId)).toBe(0);

    // يحجز من جديد
    const login = await call("POST", "/api/patient/auth/login", { email: p1.email, password: "Secret123!" });
    expect(login.data.user.isBlocked).toBe(false);
    expect((await book(login.data.accessToken)).status).toBe(201);
  });

  it("القاعدة 6: بعد الرفع، غياب جديد يعيد العدّ على آخر 7 أيام — ما زالت ≥3 داخل النافذة → حظر جديد", async () => {
    expect((await noShow(await mkAppt(p1.patientId, 0))).status).toBe(200);
    const rows = await blocksOf(p1.patientId);
    expect(rows).toHaveLength(2);
    expect(rows[0].activePatientId).toBeNull();
    expect(rows[1]).toMatchObject({ activePatientId: p1.patientId, blockType: "AUTOMATIC" });
    expect(rows[1].noShowCount).toBeGreaterThanOrEqual(3);
  });

  it("18) حظر تلقائي قديم (غيابات خارج النافذة الآن) → رفع → غيابان جديدان لا حظر → الثالث خلال 7 أيام يحظر مجددًا", async () => {
    const p = await mkPatient();
    // غيابات قديمة قبل 20..18 يومًا أدت إلى حظر تلقائي في وقتها
    for (const off of [-20, -19, -18]) await mkAppt(p.patientId, off, "NO_SHOW");
    const { evaluateAutoBlock } = await import("../../src/modules/patientBlocks/patientBlocks.service");
    expect((await evaluateAutoBlock(p.patientId, day(-18))).blocked).toBe(true);
    expect((await evaluateAutoBlock(p.patientId, day(-18))).blocked).toBe(false); // لا تكرار
    expect((await book(p.token)).status).toBe(403);
    expect((await call("POST", `/api/admin/patients/${p.patientId}/unblock`, undefined, adminToken)).status).toBe(200);
    expect((await book(p.token)).status).toBe(201);

    const n1 = await mkAppt(p.patientId, -4);
    const n2 = await mkAppt(p.patientId, -2);
    const n3 = await mkAppt(p.patientId, 0);
    expect((await noShow(n1)).status).toBe(200);
    expect((await noShow(n2)).status).toBe(200);
    expect(await activeOf(p.patientId)).toBe(0);
    expect((await noShow(n3)).status).toBe(200);
    const rows = await blocksOf(p.patientId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ activePatientId: p.patientId, noShowCount: 3, blockType: "AUTOMATIC" });
    expect(await db.appointment.count({ where: { patientId: p.patientId, status: "NO_SHOW" } })).toBe(6);
    expect((await book(p.token)).status).toBe(403);
  });

  // ---------------- التزامن ----------------

  it("19-20) طبيب ومساعد يسجّلان NO_SHOW بالتزامن (مع تكرار نفس الموعد) × 5 جولات → حظر نشط واحد وعدّ صحيح", async () => {
    for (let round = 0; round < 5; round++) {
      const p = await mkPatient();
      const appts = [await mkAppt(p.patientId, 0), await mkAppt(p.patientId, -1), await mkAppt(p.patientId, -2), await mkAppt(p.patientId, -3)];
      // كل موعد يُضغط عليه من الطبيب والمساعد معًا — 8 طلبات متوازية
      const res = await Promise.all(appts.flatMap((id) => [noShow(id, doctorToken), noShow(id, assistantToken)]));
      for (let i = 0; i < appts.length; i++) {
        const pair = [res[2 * i].status, res[2 * i + 1].status].sort();
        expect(pair).toEqual([200, 409]); // واحد يفوز لكل موعد
      }
      expect(await db.appointment.count({ where: { patientId: p.patientId, status: "NO_SHOW" } })).toBe(4);
      const rows = await blocksOf(p.patientId);
      expect(rows).toHaveLength(1);
      expect(await activeOf(p.patientId)).toBe(1);
      expect(rows[0].noShowCount).toBeGreaterThanOrEqual(3);
      expect(await db.auditLog.count({ where: { action: "BLOCK_PATIENT", entityId: p.patientId } })).toBe(1);
    }
  });

  it("التزامن: عشرة تقييمات متوازية لنفس المريض → حظر واحد فقط (القيد activePatientId)", async () => {
    const p = await mkPatient();
    for (const off of [0, -1, -2]) await mkAppt(p.patientId, off, "NO_SHOW");
    const { evaluateAutoBlock } = await import("../../src/modules/patientBlocks/patientBlocks.service");
    const out = await Promise.all(Array.from({ length: 10 }, () => evaluateAutoBlock(p.patientId)));
    expect(out.filter((o) => o.blocked)).toHaveLength(1);
    expect(await blocksOf(p.patientId)).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: "BLOCK_PATIENT", entityId: p.patientId } })).toBe(1);
  });

  it("الاعتماد التلقائي عند الإغلاق (كنس) يحظر أيضًا، والطبيب والمساعد يفتحان القائمة بالتزامن → حظر واحد", async () => {
    const p = await mkPatient();
    for (const off of [-1, -2, -3]) await mkAppt(p.patientId, off, "CONFIRMED", docSweep.doctorId);
    // موعد LATE أمس يبقى LATE حتى الإغلاق ثم يُعتمد غيابًا — منطق قائم لم يتغيّر
    const res = await Promise.all([
      call("GET", "/api/appointments", undefined, docSweep.token),
      call("GET", "/api/appointments", undefined, docSweep.asstToken),
      call("GET", "/api/appointments", undefined, docSweep.token),
    ]);
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(await db.appointment.count({ where: { patientId: p.patientId, status: "NO_SHOW" } })).toBe(3);
    const rows = await blocksOf(p.patientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockType: "AUTOMATIC", noShowCount: 3, activePatientId: p.patientId });
  });

  // ---------------- توحيد مع تقييد رقم الضيف القديم ----------------

  it("تقييد رقم الضيف القديم لا يمنع صاحب الحساب؛ حسابه يخضع للحظر الموحّد فقط", async () => {
    const p = await mkPatient();
    const guestPhone = "0791000000";
    for (let i = 0; i < 4; i++) {
      await db.appointment.create({ data: { patientId: null, guestFirstName: "ضيف", guestLastName: tag, guestPhone, doctorId: docA, date: day(-40 - i), startTime: "08:00", endTime: "08:15", status: "NO_SHOW" } });
    }
    // صاحب حساب يكتب نفس الرقم: كان يُرفض بـ«تم تقييد الحجز كضيف» بلا أي تحكم من الإدارة
    expect((await book(p.token, { phone: guestPhone })).status).toBe(201);
    // مسار الضيف (بلا حساب) في الخدمة ما زال مقيّدًا كما كان
    const { createGuestAppointment } = await import("../../src/modules/booking/booking.service");
    await expect(
      createGuestAppointment({ firstName: "ضيف", lastName: "x", phone: guestPhone, wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId: docA } as any, null)
    ).rejects.toThrow(/تقييد الحجز كضيف/);
  });
});
