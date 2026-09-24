/**
 * دورة كاملة على PostgreSQL حقيقي (تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها):
 *   مريض جديد → تسجيل → دخول → تفعيل Push → حجز مع طبيب → الموعد مرتبط بالحساب
 *   → إنشاء سجلات التذكير → محاكاة قبل ساعة (Push) → قبل 5 دقائق (Push) → تشغيل ثانٍ (لا تكرار)
 *   → إلغاء موعد آخر → لا تذكير. + حجز ضيف يبقى كما هو + عزل مريضين.
 * خدمة الدفع وحدها (web-push) مستبدلة؛ كل ما عداها (Express، Prisma، القيود الفريدة) حقيقي.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run patientReminders
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const h = vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.REMINDERS_ENABLED = "false";
  return { sendNotification: vi.fn(async () => ({ statusCode: 201 })) };
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: h.sendNotification } }));

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}

const MIN = 60_000;

describe.skipIf(!TEST_URL)("حساب المريض + التذكيرات (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let reminders: typeof import("../../src/modules/reminders/reminders.service");
  const tag = `pr${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", doctorUser: "", doctor: "", patientUsers: [] as string[] };

  const call = async (method: string, url: string, body?: unknown, token?: string, cookie?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message, setCookie: r.headers.get("set-cookie") };
  };

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    const du = await db.user.create({ data: { email: `${tag}-doc@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: du.id, firstName: "أحمد", lastName: "بن علي", specialtyId: s.id, wilayaId: w.id, cityId: c.id,
        slotDurationMin: 15, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, day) => ({ dayOfWeek: day, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id, doctorUser: du.id, doctor: d.id });
    reminders = await import("../../src/modules/reminders/reminders.service");
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: ids.doctor } } });
    await db.notification.deleteMany({ where: { userId: { in: [ids.doctorUser, ...ids.patientUsers] } } });
    await db.appointment.deleteMany({ where: { doctorId: ids.doctor } });
    await db.doctorSchedule.deleteMany({ where: { doctorId: ids.doctor } });
    await db.doctor.deleteMany({ where: { id: ids.doctor } });
    await db.pushSubscription.deleteMany({ where: { userId: { in: ids.patientUsers } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: [ids.doctorUser, ...ids.patientUsers] } } });
    await db.user.deleteMany({ where: { id: { in: [ids.doctorUser, ...ids.patientUsers] } } });
    await db.specialty.deleteMany({ where: { id: ids.specialty } });
    await db.city.deleteMany({ where: { id: ids.city } });
    await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
    await db.$disconnect();
  });

  const bookBody = () => ({ firstName: "سارة", lastName: "بن يوسف", phone: "0551234567", wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId: ids.doctor });
  const sub = (n: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${tag}-${n}`, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u", auth: "tBHItJI5svbpez7KI4CCXg" } });

  it("الدورة الكاملة: تسجيل → دخول → Push → حجز مرتبط → تذكير ساعة → تذكير 5 دقائق → لا تكرار → إلغاء", async () => {
    // 1) تسجيل ثم دخول
    const email = `${tag}-Sara@Test.local`;
    const reg = await call("POST", "/api/patient/auth/register", { email, password: "Secret123!", name: "سارة بن يوسف" });
    expect(reg.status).toBe(201);
    ids.patientUsers.push(reg.data.user.id);
    expect(reg.data.user.email).toBe(email.toLowerCase());
    const stored = await db.user.findUnique({ where: { id: reg.data.user.id } });
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/);

    const login = await call("POST", "/api/patient/auth/login", { email: email.toUpperCase(), password: "Secret123!" });
    expect(login.status).toBe(200);
    const token = login.data.accessToken as string;
    const me = await call("GET", "/api/patient/auth/me", undefined, token);
    expect(me.data.patient.firstName).toBe("سارة");

    // 2) تفعيل Push على جهازين
    expect((await call("POST", "/api/patient/notifications/subscribe", sub("phone"), token)).status).toBe(201);
    expect((await call("POST", "/api/patient/notifications/subscribe", sub("laptop"), token)).status).toBe(201);
    expect(await db.pushSubscription.count({ where: { userId: reg.data.user.id } })).toBe(2);

    // 3) حجز وهو مسجّل الدخول → مرتبط بالحساب
    const booked = await call("POST", "/api/booking", bookBody(), token);
    expect(booked.status).toBe(201);
    const appt = await db.appointment.findUnique({ where: { id: booked.data.id }, include: { patient: true } });
    expect(appt!.patient!.userId).toBe(reg.data.user.id);
    expect(appt!.guestFirstName).toBe("سارة"); // حقول الاسم محفوظة كما كانت للوحة الطبيب

    // يظهر في «مواعيدي»
    const mine = await call("GET", "/api/patient/account/appointments", undefined, token);
    expect(mine.data.map((a: any) => a.id)).toContain(appt!.id);

    const start = reminders.appointmentStartUtc(appt!.date, appt!.startTime);
    // ساعة النظام تُضبط على نفس لحظة الدورة المحاكاة: TTL/deliverBy في lib/push تُحسب من الوقت الحقيقي،
    // والموعد المحجوز آليًا يبدأ بعد دقائق فقط، فبدون هذا تصبح النتيجة مرتبطة بساعة تشغيل الاختبار.
    const cycle = async (offsetMin: number) => {
      const at = new Date(start.getTime() + offsetMin * MIN);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(at);
      try {
        return await reminders.runReminderCycle(at);
      } finally {
        vi.useRealTimers();
      }
    };

    // 4) قبل أكثر من ساعة: إنشاء السجلين فقط
    const c0 = await cycle(-61);
    expect(c0.sent).toBe(0);
    expect(await db.appointmentReminder.count({ where: { appointmentId: appt!.id } })).toBe(2);
    expect(h.sendNotification).not.toHaveBeenCalled();

    // 5) قبل ساعة: تذكير واحد يصل للجهازين
    const c1 = await cycle(-60);
    expect(c1.sent).toBe(1);
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
    const p1 = JSON.parse((h.sendNotification.mock.calls[0] as any)[1]);
    expect(p1.title).toBe("🔔 تذكير بموعدك");
    expect(p1.body).toContain("د. أحمد بن علي");

    // 6) قبل 5 دقائق
    const c2 = await cycle(-5);
    expect(c2.sent).toBe(1);
    expect(h.sendNotification).toHaveBeenCalledTimes(4);
    const p2 = JSON.parse((h.sendNotification.mock.calls[3] as any)[1]);
    expect(p2.title).toBe("موعدك مع الطبيب بعد 5 دقائق");
    // تنبيه بنمط المنبّه: نوع خاص للـService Worker، أولوية high، ولا تسليم بعد بداية الموعد.
    expect(p2.kind).toBe("APPOINTMENT_5MIN_ALARM");
    expect((h.sendNotification.mock.calls[3] as any)[2].urgency).toBe("high");
    expect(p2.deliverBy).toBe(start.toISOString());
    // تذكير الساعة بلا نوع المنبّه ولا أولوية خاصة.
    expect(p1.kind).toBeUndefined();
    expect((h.sendNotification.mock.calls[0] as any)[2].urgency).toBeUndefined();

    // 7) تشغيل ثانٍ وثالث (ومتزامن) → لا تكرار
    await Promise.all([cycle(-4), cycle(-4), reminders.processDueReminders(new Date(start.getTime() - 3 * MIN), { created: 0, sent: 0, skipped: 0, failed: 0 })]);
    await cycle(-2);
    expect(h.sendNotification).toHaveBeenCalledTimes(4);
    const rows = await db.appointmentReminder.findMany({ where: { appointmentId: appt!.id } });
    expect(rows.map((r) => r.status).sort()).toEqual(["SENT", "SENT"]);

    // 8) موعد ثانٍ يُلغى قبل وقت التذكير → لا إشعار
    const second = await call("POST", "/api/booking", bookBody(), token);
    expect(second.status).toBe(201);
    const appt2 = await db.appointment.findUnique({ where: { id: second.data.id } });
    const start2 = reminders.appointmentStartUtc(appt2!.date, appt2!.startTime);
    await reminders.runReminderCycle(new Date(start2.getTime() - 90 * MIN));
    const cancel = await call("DELETE", `/api/appointments/${appt2!.id}`, undefined, token);
    expect(cancel.status).toBe(200);
    const before = h.sendNotification.mock.calls.length;
    await reminders.runReminderCycle(new Date(start2.getTime() - 60 * MIN));
    await reminders.runReminderCycle(new Date(start2.getTime() - 5 * MIN));
    expect(h.sendNotification.mock.calls.length).toBe(before);
    const rows2 = await db.appointmentReminder.findMany({ where: { appointmentId: appt2!.id } });
    expect(rows2.every((r) => r.status === "SKIPPED" && r.skipReason === "status_CANCELLED")).toBe(true);
  });

  it("الحجز بلا حساب مرفوض (401) ولا يُنشأ موعد؛ والمواعيد القديمة بلا حساب لا تنكسر ولا تولّد تذكيرات", async () => {
    const before = await db.appointment.count({ where: { doctorId: ids.doctor } });
    const guest = await call("POST", "/api/booking", bookBody());
    expect(guest.status).toBe(401);
    expect(await db.appointment.count({ where: { doctorId: ids.doctor } })).toBe(before);

    // موعد قديم محفوظ كضيف قبل هذا التغيير (patientId = null) يبقى صالحًا ولا يُرسَل له أي تذكير.
    const legacy = await db.appointment.create({
      data: { doctorId: ids.doctor, date: new Date(Date.now() + 3 * 86400000), startTime: "10:00", endTime: "10:15", status: "CONFIRMED", guestFirstName: "قديم", guestLastName: "ضيف", guestPhone: "0551112233" },
    });
    const start = reminders.appointmentStartUtc(legacy.date, legacy.startTime);
    await reminders.runReminderCycle(new Date(start.getTime() - 60 * MIN));
    expect(await db.appointmentReminder.count({ where: { appointmentId: legacy.id } })).toBe(0);
  });

  it("مريض B يرسل patientId الخاص بـA: الموعد يُسجَّل باسم B، وتذكيره لا يصل لأجهزة A", async () => {
    const aUser = ids.patientUsers[0];
    const aPatient = await db.patient.findUnique({ where: { userId: aUser } });
    const regB = await call("POST", "/api/patient/auth/register", { email: `${tag}-spoof@test.local`, password: "Secret123!", name: "مريض منتحل" });
    expect(regB.status).toBe(201);
    ids.patientUsers.push(regB.data.user.id);
    const booked = await call("POST", "/api/booking", { ...bookBody(), patientId: aPatient!.id }, regB.data.accessToken);
    expect(booked.status).toBe(201);
    const appt = await db.appointment.findUnique({ where: { id: booked.data.id }, include: { patient: true } });
    expect(appt!.patient!.userId).toBe(regB.data.user.id);
    expect(appt!.patientId).not.toBe(aPatient!.id);

    const aEndpoints = new Set((await db.pushSubscription.findMany({ where: { userId: aUser } })).map((x) => x.endpoint));
    expect(aEndpoints.size).toBeGreaterThan(0);
    const callsBefore = h.sendNotification.mock.calls.length;
    const start = reminders.appointmentStartUtc(appt!.date, appt!.startTime);
    await reminders.runReminderCycle(new Date(start.getTime() - 61 * MIN));
    await reminders.runReminderCycle(new Date(start.getTime() - 60 * MIN));
    await reminders.runReminderCycle(new Date(start.getTime() - 5 * MIN));
    const newCalls = h.sendNotification.mock.calls.slice(callsBefore);
    expect(newCalls.some((c: any) => aEndpoints.has(c[0]?.endpoint))).toBe(false);
    // الموعد نفسه يحمل بيانات التذكير: سجلّا ساعة و5 دقائق مرتبطان به
    const rows = await db.appointmentReminder.findMany({ where: { appointmentId: appt!.id } });
    expect(rows.map((r) => r.type).sort()).toEqual(["FIVE_MINUTES", "ONE_HOUR"]);
  });

  it("عزل المرضى: مريض B لا يرى مواعيد A ولا يحذف اشتراكه", async () => {
    const regB = await call("POST", "/api/patient/auth/register", { email: `${tag}-b@test.local`, password: "Secret123!", name: "مريض ثان" });
    ids.patientUsers.push(regB.data.user.id);
    const tokenB = regB.data.accessToken;
    const list = await call("GET", "/api/patient/account/appointments", undefined, tokenB);
    expect(list.data).toEqual([]);
    const del = await call("DELETE", "/api/patient/notifications/subscribe", { endpoint: sub("phone").endpoint }, tokenB);
    expect(del.data.removed).toBe(0);
    expect(await db.pushSubscription.count({ where: { endpoint: sub("phone").endpoint } })).toBe(1);
  });

  it("سباق تسجيل نفس البريد مرتين متزامنًا: حساب واحد فقط", async () => {
    const email = `${tag}-race@test.local`;
    const [a, b] = await Promise.all([
      call("POST", "/api/patient/auth/register", { email, password: "Secret123!", name: "سباق أ" }),
      call("POST", "/api/patient/auth/register", { email: email.toUpperCase(), password: "Secret123!", name: "سباق ب" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const users = await db.user.findMany({ where: { email } });
    expect(users).toHaveLength(1);
    ids.patientUsers.push(users[0].id);
  });
});
