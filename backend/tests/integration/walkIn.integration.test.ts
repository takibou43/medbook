/**
 * «مريض حضر بدون موعد» — POST /api/appointments/walk-in على PostgreSQL حقيقي (Express + JWT + المعاملات والأقفال):
 *  - المساعد ينشئ: 201، CONFIRMED، arrivedAt الآن، اليوم، أول وقت شاغر لم يمضِ، patientId = null، بلا بيانات مالية.
 *  - لا إشعار ولا Push ولا SMS. سطر AuditLog بلا اسم ولا هاتف.
 *  - نفس المفتاح = نفس الموعد (إعادة متتالية ومتزامنة)، ومفتاح مُعاد لطلب مختلف ⇒ 409.
 *  - الهاتف المطابق لحساب مريض موجود لا يربط الموعد بذلك الحساب.
 *  - الطبيب والمريض وغير المسجَّل ممنوعون؛ المساعد المعطَّل ممنوع؛ حقول غير متوقعة أو هاتف غير جزائري ⇒ 400.
 *  - لا وقت شاغر اليوم ⇒ 409 NO_SLOT_TODAY دون إنشاء شيء.
 * خدمة الدفع وحدها (web-push) مستبدلة. تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run walkIn
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const h = vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.REMINDERS_ENABLED = "false";
  return {
    sendNotification: vi.fn(async (..._a: any[]) => ({ statusCode: 201 })),
    sendSms: vi.fn(async (..._a: any[]) => ({ ok: true })),
  };
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: h.sendNotification } }));
vi.mock("../../src/lib/sms", async (orig) => ({ ...(await orig<any>()), sendSms: h.sendSms }));

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}
const HOUR = 3600000;
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

describe.skipIf(!TEST_URL)("مريض حضر بدون موعد (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let today: Date;
  const tokens = { doctor: "", assistant: "", assistant2: "", patient: "" };
  const tag = `wi${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", doctor: "", patient: "", patientUser: "", assistant2: "", otherDoctor: "", assistantUser: "", users: [] as string[] };
  const PATIENT_PHONE = `07${String(Date.now()).slice(-8)}`;

  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined, code: j?.code ?? j?.details?.code, raw: j };
  };
  const walkIn = (body: Record<string, unknown>, token = tokens.assistant) => call("POST", "/api/appointments/walk-in", token, body);
  const body = (over: Record<string, unknown> = {}) => ({
    firstName: "زائر",
    lastName: tag,
    phone: "0551 23 45 67",
    idempotencyKey: randomUUID(),
    ...over,
  });
  const countToday = () => db.appointment.count({ where: { doctorId: ids.doctor, date: today } });

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });
    const du = await db.user.create({ data: { email: `${tag}-doc@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: du.id, firstName: "طبيب", lastName: tag, specialtyId: s.id, wilayaId: w.id, cityId: c.id, slotDurationMin: 5,
        verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, k) => ({ dayOfWeek: k, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    // طبيب آخر لا يعمل معه المساعد: محاولة استهدافه عبر الترويسة يجب أن تُرفض.
    const du2 = await db.user.create({ data: { email: `${tag}-doc2@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d2 = await db.doctor.create({
      data: {
        userId: du2.id, firstName: "طبيب2", lastName: tag, specialtyId: s.id, wilayaId: w.id, cityId: c.id, slotDurationMin: 5,
        verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, k) => ({ dayOfWeek: k, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    ids.otherDoctor = d2.id;
    ids.users.push(du2.id);
    const pu = await db.user.create({
      data: { email: `${tag}-p@test.local`, phone: PATIENT_PHONE, passwordHash: "x", role: "PATIENT", patient: { create: { firstName: "مريض", lastName: tag } } },
      include: { patient: true },
    });
    const au = await db.user.create({ data: { email: `${tag}-asst@test.local`, passwordHash: "x", role: "ASSISTANT" } });
    await db.assistant.create({ data: { userId: au.id, doctorId: d.id, firstName: "مساعد", lastName: tag } });
    const au2 = await db.user.create({ data: { email: `${tag}-asst2@test.local`, passwordHash: "x", role: "ASSISTANT" } });
    const a2 = await db.assistant.create({ data: { userId: au2.id, doctorId: d.id, firstName: "مساعد2", lastName: tag } });
    // اشتراك Push للمريض: أي إشعار خاطئ سيظهر في sendNotification.
    await db.pushSubscription.create({ data: { userId: pu.id, endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`, p256dh: "k", auth: "a" } });
    await db.pushSubscription.create({ data: { userId: du.id, endpoint: `https://fcm.googleapis.com/fcm/send/${tag}-d`, p256dh: "k", auth: "a" } });
    Object.assign(ids, { doctor: d.id, patient: pu.patient!.id, patientUser: pu.id, assistant2: a2.id, assistantUser: au.id });
    ids.users.push(du.id, pu.id, au.id, au2.id);

    const { signAccessToken } = await import("../../src/utils/jwt");
    tokens.doctor = signAccessToken({ sub: du.id, role: "DOCTOR" } as any);
    tokens.assistant = signAccessToken({ sub: au.id, role: "ASSISTANT" } as any);
    tokens.assistant2 = signAccessToken({ sub: au2.id, role: "ASSISTANT" } as any);
    tokens.patient = signAccessToken({ sub: pu.id, role: "PATIENT" } as any);
    today = (await import("../../src/lib/slots")).algeriaTodayUTCMidnight();
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);

  afterAll(async () => {
    server?.close();
    if (db) {
      await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: ids.doctor } } });
      await db.appointmentFinancial.deleteMany({ where: { appointment: { doctorId: ids.doctor } } }).catch(() => undefined);
      await db.appointment.deleteMany({ where: { doctorId: ids.doctor } });
      await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
      await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
      await db.pushSubscription.deleteMany({ where: { userId: { in: ids.users } } });
      await db.assistant.deleteMany({ where: { doctorId: ids.doctor } });
      await db.appointment.deleteMany({ where: { doctorId: ids.otherDoctor } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: { in: [ids.doctor, ids.otherDoctor] } } });
      await db.doctor.deleteMany({ where: { id: { in: [ids.doctor, ids.otherDoctor] } } });
      await db.patient.deleteMany({ where: { id: ids.patient } });
      await db.user.deleteMany({ where: { id: { in: ids.users } } });
      await db.specialty.deleteMany({ where: { id: ids.specialty } });
      await db.city.deleteMany({ where: { id: ids.city } });
      await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
      await db.$disconnect();
    }
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  beforeEach(() => {
    h.sendNotification.mockClear();
    h.sendSms.mockClear();
    // نثبّت Date فقط على 10:00 بتوقيت الجزائر؛ HTTP وPostgreSQL والمؤقّتات حقيقية.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(today.getTime() + 9 * HOUR));
  });
  afterEach(() => vi.useRealTimers());

  it("المساعد يسجّل زائرًا: 201، اليوم، أول وقت شاغر بعد الآن، CONFIRMED، وصل الآن، بلا حساب ولا بيانات مالية", async () => {
    const before = Date.now();
    const r = await walkIn(body());
    expect(r.status).toBe(201);
    expect(r.data.replayed).toBe(false);
    expect(r.data.status).toBe("CONFIRMED");
    expect(r.data.patientId).toBeNull();
    expect(r.data.guestPhone).toBe("0551234567");
    expect(r.data.createdBy).toBe("GUEST");
    expect(new Date(r.data.date).getTime()).toBe(today.getTime());
    expect(toMin(r.data.startTime)).toBeGreaterThanOrEqual(10 * 60);
    expect(toMin(r.data.startTime)).toBeLessThan(10 * 60 + 5 + 1);
    expect(new Date(r.data.arrivedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(r.raw)).not.toMatch(/financial|doctorShare|commission|createdByUserId/i);

    const row = await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } });
    expect(row.familyMemberId).toBeNull();
    expect(row.activeSlot).toBe(true);
    expect(row.createdByUserId).toBe(ids.assistantUser);
    // الملاحظة الثابتة دائمًا، حتى بلا ملاحظات مُدخلة.
    expect(row.notes).toBe("سُجّل بواسطة المساعد");
    expect(r.data.notes).toBe("سُجّل بواسطة المساعد");

    const audit = await db.auditLog.findFirst({ where: { action: "WALK_IN_APPOINTMENT_CREATED", entityId: r.data.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit!.meta)).not.toMatch(/0551234567|زائر/);
  });

  it("لا إشعار ولا Push ولا SMS لأي طرف", async () => {
    const notifBefore = await db.notification.count({ where: { userId: { in: ids.users } } });
    const r = await walkIn(body({ firstName: "بلاإشعار" }));
    expect(r.status).toBe(201);
    await new Promise((res) => setTimeout(res, 300));
    expect(await db.notification.count({ where: { userId: { in: ids.users } } })).toBe(notifBefore);
    expect(await db.notification.count({ where: { appointmentId: r.data.id } })).toBe(0);
    expect(h.sendNotification).not.toHaveBeenCalled();
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(await db.appointmentReminder.count({ where: { appointmentId: r.data.id } })).toBe(0);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } })).reminderSentAt).toBeNull();
  });

  it("استهداف طبيب آخر عبر X-Assistant-Doctor-Id ⇒ 403، ولا موعد عند أي من الطبيبين", async () => {
    const n = await countToday();
    const r = await fetch(base + "/api/appointments/walk-in", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + tokens.assistant, "X-Assistant-Doctor-Id": ids.otherDoctor },
      body: JSON.stringify(body({ firstName: "مستهدف" })),
    });
    expect(r.status).toBe(403);
    expect(await countToday()).toBe(n);
    expect(await db.appointment.count({ where: { doctorId: ids.otherDoctor } })).toBe(0);
  });

  it("نفس المفتاح مرتين متتاليتين ⇒ نفس الموعد (200، replayed) ولا موعد ثانٍ", async () => {
    const b = body({ firstName: "مكرر" });
    const r1 = await walkIn(b);
    const n = await countToday();
    const r2 = await walkIn(b);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.data.replayed).toBe(true);
    expect(r2.data.id).toBe(r1.data.id);
    expect(await countToday()).toBe(n);
  });

  it("6 طلبات متزامنة بنفس المفتاح ⇒ موعد واحد فقط", async () => {
    const b = body({ firstName: "متزامن" });
    const n = await countToday();
    const rs = await Promise.all(Array.from({ length: 6 }, () => walkIn(b)));
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.data.id)).size).toBe(1);
    expect(await countToday()).toBe(n + 1);
  });

  it("مفاتيح مختلفة متزامنة ⇒ مواعيد مختلفة في أوقات مختلفة (القيد الفريد سليم)", async () => {
    const rs = await Promise.all(Array.from({ length: 4 }, (_, i) => walkIn(body({ firstName: `متعدد${i}` }))));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.data.startTime)).size).toBe(4);
  });

  it("مفتاح مُعاد لطلب مختلف أو من مساعد آخر ⇒ 409 دون إنشاء", async () => {
    const key = randomUUID();
    expect((await walkIn(body({ idempotencyKey: key, firstName: "أصلي" }))).status).toBe(201);
    const n = await countToday();
    const diff = await walkIn(body({ idempotencyKey: key, firstName: "مختلف" }));
    expect(diff.status).toBe(409);
    const other = await walkIn(body({ idempotencyKey: key, firstName: "أصلي" }), tokens.assistant2);
    expect(other.status).toBe(409);
    expect(await countToday()).toBe(n);
  });

  it("هاتف مطابق لحساب مريض موجود لا يربط الموعد بالحساب", async () => {
    const r = await walkIn(body({ phone: PATIENT_PHONE, firstName: "مريض", lastName: tag }));
    expect(r.status).toBe(201);
    const row = await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } });
    expect(row.patientId).toBeNull();
    expect(row.familyMemberId).toBeNull();
    expect(await db.notification.count({ where: { userId: ids.patientUser } })).toBe(0);
  });

  it("الطبيب والمريض وغير المسجَّل ممنوعون", async () => {
    const n = await countToday();
    expect((await walkIn(body(), tokens.doctor)).status).toBe(403);
    expect((await walkIn(body(), tokens.patient)).status).toBe(403);
    expect((await call("POST", "/api/appointments/walk-in", undefined, body())).status).toBe(401);
    expect(await countToday()).toBe(n);
  });

  it("تحقق المدخلات: هاتف غير جزائري، اسم قصير، مفتاح غير UUID، وحقول غير متوقعة (patientId) ⇒ 400", async () => {
    const n = await countToday();
    expect((await walkIn(body({ phone: "0312345678" }))).status).toBe(400);
    expect((await walkIn(body({ phone: "05512345" }))).status).toBe(400);
    expect((await walkIn(body({ firstName: "a" }))).status).toBe(400);
    expect((await walkIn(body({ idempotencyKey: "abc" }))).status).toBe(400);
    expect((await walkIn(body({ patientId: ids.patient }))).status).toBe(400);
    expect((await walkIn(body({ doctorId: ids.doctor }))).status).toBe(400);
    expect(await countToday()).toBe(n);
  });

  it("الزائر يظهر في طابور اليوم للمساعد والطبيب، ويمكن مناداته", async () => {
    const r = await walkIn(body({ firstName: "طابور" }));
    expect(r.status).toBe(201);
    for (const t of [tokens.assistant, tokens.doctor]) {
      const q = await call("GET", "/api/appointments/queue", t);
      expect(q.status).toBe(200);
      expect(JSON.stringify(q.data)).toContain(r.data.id);
    }
  });

  it("المساعد المعطَّل ممنوع", async () => {
    await db.assistant.update({ where: { id: ids.assistant2 }, data: { isActive: false } });
    try {
      const n = await countToday();
      expect((await walkIn(body(), tokens.assistant2)).status).toBe(403);
      expect(await countToday()).toBe(n);
    } finally {
      await db.assistant.update({ where: { id: ids.assistant2 }, data: { isActive: true } });
    }
  });

  it("الملاحظات المُدخلة تُحفظ بعد عبارة «سُجّل بواسطة المساعد»", async () => {
    const r = await walkIn(body({ firstName: "بملاحظة", notes: "  حرارة منذ يومين  " }));
    expect(r.status).toBe(201);
    const row = await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } });
    expect(row.notes).toBe("سُجّل بواسطة المساعد — حرارة منذ يومين");
    const audit = await db.auditLog.findFirst({ where: { action: "WALK_IN_APPOINTMENT_CREATED", entityId: r.data.id } });
    expect(JSON.stringify(audit!.meta)).not.toMatch(/حرارة/);
  });

  it("وقت محدد متاح اليوم ⇒ يُحجز ذلك الوقت بالضبط", async () => {
    const r = await walkIn(body({ firstName: "بوقت", startTime: "15:00" }));
    expect(r.status).toBe(201);
    expect(r.data.startTime).toBe("15:00");
    expect(r.data.endTime).toBe("15:05");
    expect(r.data.status).toBe("CONFIRMED");
    expect(r.data.arrivedAt).toBeTruthy();
  });

  it("وقت محدد محجوز ⇒ 409 SLOT_TAKEN برسالة واضحة، ولا يُنقل إلى وقت آخر ولا يُنشأ شيء", async () => {
    expect((await walkIn(body({ firstName: "أول", startTime: "15:30" }))).status).toBe(201);
    const n = await countToday();
    const r = await walkIn(body({ firstName: "ثانٍ", startTime: "15:30" }));
    expect(r.status).toBe(409);
    expect(r.raw?.details?.code ?? r.code).toBe("SLOT_TAKEN");
    expect(r.message).toMatch(/15:30 محجوز/);
    expect(await countToday()).toBe(n);
  });

  it("وقت محدد مضى، أو خارج شبكة الأوقات، أو بصيغة خاطئة ⇒ 400 دون إنشاء", async () => {
    const n = await countToday();
    const past = await walkIn(body({ startTime: "09:00" }));
    expect(past.status).toBe(400);
    expect(past.message).toMatch(/مضى/);
    const offGrid = await walkIn(body({ startTime: "15:02" }));
    expect(offGrid.status).toBe(400);
    expect(offGrid.message).toMatch(/ليس من أوقات عمل الطبيب/);
    expect((await walkIn(body({ startTime: "9:00" }))).status).toBe(400);
    expect((await walkIn(body({ startTime: "24:00" }))).status).toBe(400);
    expect(await countToday()).toBe(n);
  });

  it("نفس المفتاح بنفس الوقت المحدد ⇒ نفس الموعد؛ ومع وقت مختلف أو ملاحظات مختلفة ⇒ 409", async () => {
    const key = randomUUID();
    const b = body({ idempotencyKey: key, firstName: "مفتاح", startTime: "16:00", notes: "أولى" });
    const r1 = await walkIn(b);
    expect(r1.status).toBe(201);
    const n = await countToday();
    const same = await walkIn(b);
    expect(same.status).toBe(200);
    expect(same.data.id).toBe(r1.data.id);
    const otherTime = await walkIn({ ...b, startTime: "16:05" });
    expect(otherTime.status).toBe(409);
    expect(otherTime.message).toMatch(/مفتاح الطلب مستعمل/);
    const otherNotes = await walkIn({ ...b, notes: "ثانية" });
    expect(otherNotes.status).toBe(409);
    const noNotes = await walkIn({ ...b, notes: undefined });
    expect(noNotes.status).toBe(409);
    expect(await countToday()).toBe(n);
    expect(await db.appointment.count({ where: { doctorId: ids.doctor, date: today, startTime: "16:05" } })).toBe(0);
  });

  it("مفتاح بلا وقت محدد ثم إعادة بوقت مختلف ⇒ 409؛ وبلا ملاحظات ثم بملاحظات ⇒ 409", async () => {
    const key = randomUUID();
    const b = body({ idempotencyKey: key, firstName: "تلقائي" });
    const r1 = await walkIn(b);
    expect(r1.status).toBe(201);
    const n = await countToday();
    const wrongTime = r1.data.startTime === "17:00" ? "17:05" : "17:00";
    expect((await walkIn({ ...b, startTime: wrongTime })).status).toBe(409);
    expect((await walkIn({ ...b, startTime: r1.data.startTime })).status).toBe(200);
    expect((await walkIn({ ...b, notes: "إضافة" })).status).toBe(409);
    expect(await countToday()).toBe(n);
  });

  it("5 طلبات متزامنة بنفس المفتاح ووقت محدد ⇒ موعد واحد، والبقية تعيده", async () => {
    const b = body({ firstName: "متزامن-وقت", startTime: "18:00" });
    const n = await countToday();
    const rs = await Promise.all(Array.from({ length: 5 }, () => walkIn(b)));
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.data.id)).size).toBe(1);
    expect(await countToday()).toBe(n + 1);
  });

  it("طلبان متزامنان بمفتاحين مختلفين على نفس الوقت المحدد ⇒ واحد 201 والآخر 409 SLOT_TAKEN", async () => {
    const n = await countToday();
    const rs = await Promise.all([walkIn(body({ firstName: "سباق1", startTime: "18:30" })), walkIn(body({ firstName: "سباق2", startTime: "18:30" }))]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await countToday()).toBe(n + 1);
  });

  it("حجز المساعد الآلي يعيد استخدام فترة مكتملة مبكرًا، ويحمي المفتاح القديم والحجز الجديد", async () => {
    vi.setSystemTime(new Date(today.getTime() + 13 * HOUR + 14 * 60000 + 30000)); // 14:14:30 Algeria
    const historical = await db.appointment.create({ data: {
      doctorId: ids.doctor, date: today, startTime: "14:15", endTime: "23:59", status: "COMPLETED",
      guestFirstName: "قديم", guestLastName: "مكتمل", activeSlot: true, endedAt: new Date(),
    } });
    try {
      const firstBody = body({ firstName: "أقرب" });
      const first = await walkIn(firstBody);
      expect(first.status).toBe(201);
      expect(first.data.startTime).toBe("14:16");
      expect(first.data.endTime).toBe("14:21");
      expect(new Date(first.data.date).getTime()).toBe(today.getTime());
      const replay = await walkIn(firstBody);
      expect(replay.status).toBe(200);
      expect(replay.data.id).toBe(first.data.id);
      const next = await walkIn(body({ firstName: "بعده" }));
      expect(next.status).toBe(201);
      expect(next.data.startTime).toBe("14:21");
      expect((await db.appointment.findUniqueOrThrow({ where: { id: historical.id } })).status).toBe("COMPLETED");
      expect(h.sendNotification).not.toHaveBeenCalled();
      expect(h.sendSms).not.toHaveBeenCalled();
    } finally {
      await db.appointment.delete({ where: { id: historical.id } });
    }
  });

  it("لا وقت شاغر متبقٍّ اليوم ⇒ 409 NO_SLOT_TODAY دون إنشاء", async () => {
    vi.setSystemTime(new Date(today.getTime() + 22 * HOUR + 58 * 60000)); // 23:58 بالجزائر: آخر فترة مضت
    // توكن موقَّع بعد تقديم الساعة، وإلا انتهت صلاحية توكن الإعداد (15 دقيقة) وأعاد 401 بدل 409.
    const { signAccessToken } = await import("../../src/utils/jwt");
    const lateToken = signAccessToken({ sub: ids.assistantUser, role: "ASSISTANT" } as any);
    const n = await countToday();
    const r = await walkIn(body({ firstName: "متأخر" }), lateToken);
    expect(r.status).toBe(409);
    expect(r.message).toMatch(/لا يوجد وقت شاغر اليوم/);
    expect(await countToday()).toBe(n);
  });
});
