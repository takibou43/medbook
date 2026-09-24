/**
 * انتهاء إشعارات الموعد بانتهاء يوم الموعد (توقيت الجزائر) — PostgreSQL حقيقي، Express حقيقي،
 * وخدمة الدفع وحدها (web-push) مستبدلة. تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 *  1) إشعار موعد اليوم: مرتبط بالموعد (appointmentId/appointmentDate/expiresAt)، يظهر في مركز الإشعارات،
 *     والـPush يحمل نفس الحقول ووسم الموعد وTTL حتى نهاية اليوم.
 *  2) بعد نهاية اليوم: يختفي من القائمة ثم يُحذف دوريًا؛ إشعار موعد الغد والإشعار العام يبقيان.
 *  3) إشعار منتهٍ في القاعدة لا يعود عند فتح التطبيق (GET /api/notifications).
 *  4) لا إشعار (داخل التطبيق ولا Push) لموعد انتهى يومه، حتى لو تغيّرت حالته الآن.
 *  5) الحجز ينشئ إشعار الطبيب مرتبطًا بالموعد.
 *  6) تذكيرات الساعة/5 دقائق تحمل الموعد ووسمه ونهاية يومه.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const h = vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.REMINDERS_ENABLED = "false";
  return { sendNotification: vi.fn(async (..._a: any[]) => ({ statusCode: 201 })) };
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: h.sendNotification } }));

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}
const DAY = 86400000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!TEST_URL)("انتهاء إشعارات الموعد بانتهاء يومه (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let notif: typeof import("../../src/modules/notifications/notifications.service");
  let expiry: typeof import("../../src/lib/appointmentExpiry");
  let today: Date;
  const tag = `ne${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", doctor: "", doctorUser: "", patient: "", patientUser: "", userIds: [] as string[] };
  let doctorToken = "";
  let patientToken = "";

  const call = async (method: string, url: string, body: unknown, token: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message };
  };
  const mkAppt = (offsetDays: number, startTime: string, status: any = "CONFIRMED") =>
    db.appointment.create({
      data: {
        doctorId: ids.doctor, patientId: ids.patient, date: new Date(today.getTime() + offsetDays * DAY), startTime,
        endTime: startTime.replace(/:(\d\d)$/, (_m, mm) => ":" + String(Math.min(59, Number(mm) + 10)).padStart(2, "0")),
        status, guestFirstName: "مريض", guestLastName: tag,
      },
    });
  const pushesFor = (appointmentId: string) =>
    h.sendNotification.mock.calls.map((c: any[]) => ({ payload: JSON.parse(c[1]), options: c[2] })).filter((p) => p.payload.appointmentId === appointmentId);

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
        userId: du.id, firstName: "طبيب", lastName: tag, specialtyId: s.id, wilayaId: w.id, cityId: c.id, slotDurationMin: 10,
        verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, k) => ({ dayOfWeek: k, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    const pu = await db.user.create({
      data: { email: `${tag}-p@test.local`, passwordHash: "x", role: "PATIENT", patient: { create: { firstName: "مريض", lastName: tag } } },
      include: { patient: true },
    });
    Object.assign(ids, { doctor: d.id, doctorUser: du.id, patient: pu.patient!.id, patientUser: pu.id });
    ids.userIds.push(du.id, pu.id);
    await db.pushSubscription.create({ data: { userId: pu.id, endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`, p256dh: "k", auth: "a" } });
    await db.pushSubscription.create({ data: { userId: du.id, endpoint: `https://fcm.googleapis.com/fcm/send/${tag}-doc`, p256dh: "k", auth: "a" } });

    const { signAccessToken } = await import("../../src/utils/jwt");
    doctorToken = signAccessToken({ sub: du.id, role: "DOCTOR" } as any);
    patientToken = signAccessToken({ sub: pu.id, role: "PATIENT" } as any);
    today = (await import("../../src/lib/slots")).algeriaTodayUTCMidnight();
    notif = await import("../../src/modules/notifications/notifications.service");
    expiry = await import("../../src/lib/appointmentExpiry");
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);

  afterAll(async () => {
    server?.close();
    if (db) {
      await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: ids.doctor } } });
      await db.appointment.deleteMany({ where: { doctorId: ids.doctor } }); // يحذف إشعاراتها (Cascade)
      await db.notification.deleteMany({ where: { userId: { in: ids.userIds } } });
      await db.patientBlock.deleteMany({ where: { patientId: ids.patient } }).catch(() => undefined);
      await db.pushSubscription.deleteMany({ where: { userId: { in: ids.userIds } } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: ids.doctor } });
      await db.doctor.deleteMany({ where: { id: ids.doctor } });
      await db.patient.deleteMany({ where: { id: ids.patient } });
      await db.user.deleteMany({ where: { id: { in: ids.userIds } } });
      await db.specialty.deleteMany({ where: { id: ids.specialty } });
      await db.city.deleteMany({ where: { id: ids.city } });
      await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
      await db.$disconnect();
    }
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  beforeEach(() => h.sendNotification.mockClear());

  it("1) إشعار موعد اليوم (تغيير حالة من الطبيب): مرتبط بالموعد، ظاهر في المركز، والـPush بوسم الموعد وTTL حتى نهاية اليوم", async () => {
    const a = await mkAppt(0, "23:50");
    const r = await call("PATCH", `/api/appointments/${a.id}`, { status: "COMPLETED" }, doctorToken);
    expect(r.status).toBe(200);
    const row = await db.notification.findFirst({ where: { userId: ids.patientUser, appointmentId: a.id } });
    expect(row).toBeTruthy();
    expect(row!.appointmentDate!.getTime()).toBe(today.getTime());
    expect(row!.expiresAt!.toISOString()).toBe(expiry.appointmentDayEndsAt(today).toISOString());
    expect(row!.expiresAt!.getTime()).toBe(today.getTime() + DAY - 3600000); // منتصف ليل الجزائر التالي

    const list = await call("GET", "/api/notifications", undefined, patientToken);
    expect(list.data.map((n: any) => n.id)).toContain(row!.id);
    const item = list.data.find((n: any) => n.id === row!.id);
    expect(item).toMatchObject({ appointmentId: a.id });
    expect(typeof item.expiresAt).toBe("string");

    await sleep(200);
    const [p] = pushesFor(a.id);
    expect(p.payload).toMatchObject({ tag: `appt-${a.id}`, appointmentId: a.id, appointmentDate: today.toISOString().slice(0, 10), expiresAt: row!.expiresAt!.toISOString(), url: `/account?appointment=${a.id}` });
    expect(p.options.TTL).toBeGreaterThan(0);
    expect(p.options.TTL).toBeLessThanOrEqual(24 * 3600);
  });

  it("2) عند نهاية اليوم: إشعار موعد اليوم يختفي ثم يُحذف؛ إشعار موعد الغد والإشعار العام يبقيان", async () => {
    const aToday = await mkAppt(0, "23:40");
    const aTomorrow = await mkAppt(1, "10:00");
    const nToday = await notif.createNotification(ids.patientUser, "APPOINTMENT_CONFIRMED", "اليوم", "م", undefined, undefined, { id: aToday.id, date: aToday.date });
    const nTomorrow = await notif.createNotification(ids.patientUser, "APPOINTMENT_CONFIRMED", "غدًا", "م", undefined, undefined, { id: aTomorrow.id, date: aTomorrow.date });
    const nGeneral = await notif.createNotification(ids.patientUser, "NEW_MESSAGE", "رسالة عامة", "م");
    expect(nToday && nTomorrow && nGeneral).toBeTruthy();
    expect(nGeneral!.expiresAt).toBeNull();
    expect(nGeneral!.appointmentId).toBeNull();

    const endOfToday = expiry.appointmentDayEndsAt(today);
    const justBefore = new Date(endOfToday.getTime() - 1000); // 23:59:59 بتوقيت الجزائر
    const justAfter = new Date(endOfToday.getTime() + 1000); // 00:00:01 بتوقيت الجزائر
    const idsBefore = (await notif.listForUser(ids.patientUser, false, justBefore)).map((n) => n.id);
    expect(idsBefore).toEqual(expect.arrayContaining([nToday!.id, nTomorrow!.id, nGeneral!.id]));

    const idsAfter = (await notif.listForUser(ids.patientUser, false, justAfter)).map((n) => n.id);
    expect(idsAfter).not.toContain(nToday!.id);
    expect(idsAfter).toEqual(expect.arrayContaining([nTomorrow!.id, nGeneral!.id]));
    expect((await notif.listForUser(ids.patientUser, true, justAfter)).map((n) => n.id)).not.toContain(nToday!.id);

    const purged = await notif.purgeExpiredNotifications(justAfter);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await db.notification.findUnique({ where: { id: nToday!.id } })).toBeNull();
    expect(await db.notification.findUnique({ where: { id: nTomorrow!.id } })).not.toBeNull();
    expect(await db.notification.findUnique({ where: { id: nGeneral!.id } })).not.toBeNull();
    // الموعد نفسه لم يُمسّ
    expect(await db.appointment.findUnique({ where: { id: aToday.id } })).not.toBeNull();
  });

  it("3) إشعار موعد منتهٍ موجود في القاعدة لا يظهر عند فتح التطبيق، والعام يظهر", async () => {
    const aYesterday = await mkAppt(-1, "09:00", "COMPLETED");
    const stale = await db.notification.create({
      data: {
        userId: ids.patientUser, type: "APPOINTMENT_LATE", title: "قديم", message: "م",
        appointmentId: aYesterday.id, appointmentDate: aYesterday.date, expiresAt: expiry.appointmentDayEndsAt(aYesterday.date),
      },
    });
    const general = await db.notification.create({ data: { userId: ids.patientUser, type: "NEW_MESSAGE", title: "عام", message: "م" } });
    const all = await call("GET", "/api/notifications", undefined, patientToken);
    const unread = await call("GET", "/api/notifications?unread=true", undefined, patientToken);
    for (const r of [all, unread]) {
      expect(r.status).toBe(200);
      expect(r.data.map((n: any) => n.id)).not.toContain(stale.id);
      expect(r.data.map((n: any) => n.id)).toContain(general.id);
    }
  });

  it("4) موعد انتهى يومه: لا إشعار داخل التطبيق ولا Push حتى لو غيّر الطبيب حالته الآن", async () => {
    const aYesterday = await mkAppt(-1, "10:00", "CONFIRMED");
    const before = await db.notification.count({ where: { appointmentId: aYesterday.id } });
    const t0 = new Date();
    const r = await call("PATCH", `/api/appointments/${aYesterday.id}`, { status: "COMPLETED" }, doctorToken);
    expect(r.status).toBe(200);
    await sleep(200);
    expect(await db.notification.count({ where: { appointmentId: aYesterday.id } })).toBe(before);
    expect(await db.notification.count({ where: { userId: ids.patientUser, title: "اكتمل موعدك", createdAt: { gte: t0 } } })).toBe(0);
    expect(pushesFor(aYesterday.id)).toHaveLength(0);
    expect(h.sendNotification).not.toHaveBeenCalled();

    // المسار المباشر كذلك
    const res = await notif.createNotification(ids.patientUser, "APPOINTMENT_LATE", "t", "m", undefined, "appt-x", { id: aYesterday.id, date: aYesterday.date });
    expect(res).toBeNull();
    await sleep(100);
    expect(h.sendNotification).not.toHaveBeenCalled();
  });

  it("5) الحجز: إشعار الطبيب مرتبط بالموعد وينتهي بنهاية يومه", async () => {
    const r = await call("POST", "/api/booking", { firstName: "مريض", lastName: "حجز", wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId: ids.doctor }, patientToken);
    expect(r.status).toBe(201);
    const appt = await db.appointment.findUnique({ where: { id: r.data.id } });
    const row = await db.notification.findFirst({ where: { userId: ids.doctorUser, appointmentId: appt!.id } });
    expect(row).toBeTruthy();
    expect(row!.type).toBe("APPOINTMENT_CREATED");
    expect(row!.expiresAt!.toISOString()).toBe(expiry.appointmentDayEndsAt(appt!.date).toISOString());
  });

  it("6) تذكيرات Push (قبل ساعة / 5 دقائق) تحمل الموعد ووسمه ونهاية يومه — لموعد الغد نهاية الغد", async () => {
    const { buildReminderPayload } = await import("../../src/modules/reminders/reminders.service");
    const tomorrow = new Date(today.getTime() + DAY);
    const appt = { id: "A-tomorrow", date: tomorrow, startTime: "00:30", doctor: { firstName: "س", lastName: "ع" } };
    for (const type of ["ONE_HOUR", "FIVE_MINUTES"] as const) {
      const p = buildReminderPayload(type as any, appt, new Date(tomorrow.getTime() - 3600000 - 30 * 60000));
      expect(p).toMatchObject({ tag: "appt-A-tomorrow", appointmentId: "A-tomorrow", appointmentDate: tomorrow.toISOString().slice(0, 10) });
      expect(p.expiresAt).toBe(expiry.appointmentDayEndsAt(tomorrow).toISOString());
    }
  });
});
