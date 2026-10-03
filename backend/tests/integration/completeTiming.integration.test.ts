/**
 * منع «اكتمل الموعد» قبل حلول وقته عبر مسار PATCH العام، على PostgreSQL حقيقي (Express + JWT + المعاملات):
 *  - CONFIRMED اليوم قبل startTime ⇒ 400، ولا يتغير شيء: الحالة، endedAt، durationMinutes، الإشعار، Push، عدّاد المكتملة.
 *  - CONFIRMED اليوم بعد startTime ⇒ 200.
 *  - IN_PROGRESS أو LATE اليوم قبل startTime ⇒ 200 (المريض استُدعي فعليًا).
 *  - موعد في يوم لاحق ⇒ 400، وموعد يوم سابق ⇒ 200 (القاعدة الحالية).
 *  - المساعد ما زال ممنوعًا من COMPLETED.
 * خدمة الدفع وحدها (web-push) مستبدلة. تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run completeTiming
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
/** دقائق «الآن» بتوقيت الجزائر (UTC+1 ثابت، كما في lib/slots). */
const algeriaNowMinutes = () => Math.floor(((Date.now() + 3600000) % DAY) / 60000);
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

describe.skipIf(!TEST_URL)("لا «اكتمل الموعد» قبل وقته (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let today: Date;
  let doctorToken = "";
  let assistantToken = "";
  const tag = `ct${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", doctor: "", patient: "", patientUser: "", users: [] as string[] };
  let usedMinutes = new Set<number>();

  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined };
  };
  /** موعد بوقت فريد عند هذا الطبيب (تجنّب تعارض الفتحات النشطة). */
  async function mkAppt(offsetDays: number, minute: number, status: any = "CONFIRMED") {
    let m = minute;
    while (usedMinutes.has(offsetDays * 10000 + m)) m += 1;
    usedMinutes.add(offsetDays * 10000 + m);
    const start = hhmm(m);
    return db.appointment.create({
      data: {
        doctorId: ids.doctor, patientId: ids.patient, date: new Date(today.getTime() + offsetDays * DAY),
        startTime: start, endTime: hhmm(Math.min(m + 5, 23 * 60 + 59)), status, guestFirstName: "مريض", guestLastName: tag,
        ...(status === "IN_PROGRESS" ? { calledAt: new Date() } : {}),
      },
    });
  }
  const complete = (id: string, token = doctorToken) => call("PATCH", `/api/appointments/${id}`, token, { status: "COMPLETED" });
  const completedCount = () => db.appointment.count({ where: { doctorId: ids.doctor, status: "COMPLETED" } });

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
    const pu = await db.user.create({
      data: { email: `${tag}-p@test.local`, passwordHash: "x", role: "PATIENT", patient: { create: { firstName: "مريض", lastName: tag } } },
      include: { patient: true },
    });
    const au = await db.user.create({ data: { email: `${tag}-asst@test.local`, passwordHash: "x", role: "ASSISTANT" } });
    await db.assistant.create({ data: { userId: au.id, doctorId: d.id, firstName: "مساعد", lastName: tag } });
    await db.pushSubscription.create({ data: { userId: pu.id, endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`, p256dh: "k", auth: "a" } });
    Object.assign(ids, { doctor: d.id, patient: pu.patient!.id, patientUser: pu.id });
    ids.users.push(du.id, pu.id, au.id);

    const { signAccessToken } = await import("../../src/utils/jwt");
    doctorToken = signAccessToken({ sub: du.id, role: "DOCTOR" } as any);
    assistantToken = signAccessToken({ sub: au.id, role: "ASSISTANT" } as any);
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
      await db.appointment.deleteMany({ where: { doctorId: ids.doctor } });
      await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
      await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
      await db.pushSubscription.deleteMany({ where: { userId: { in: ids.users } } });
      await db.assistant.deleteMany({ where: { doctorId: ids.doctor } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: ids.doctor } });
      await db.doctor.deleteMany({ where: { id: ids.doctor } });
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

  beforeEach(() => h.sendNotification.mockClear());

  it("CONFIRMED اليوم قبل وقته ⇒ 400 برسالة مفهومة، ولا أي أثر جانبي", async (ctx) => {
    const now = algeriaNowMinutes();
    if (now > 23 * 60 + 50) ctx.skip(); // لا يبقى وقت لاحق اليوم
    const a = await mkAppt(0, Math.min(now + 30, 23 * 60 + 59));
    const before = await completedCount();

    const r = await complete(a.id);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/قبل حلول وقته/);
    expect(r.message).toContain(a.startTime);

    const after = await db.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.endedAt).toBeNull();
    expect(after.durationMinutes).toBeNull();
    expect(await completedCount()).toBe(before);
    expect(await db.notification.count({ where: { appointmentId: a.id } })).toBe(0);
    await sleep(150);
    expect(h.sendNotification).not.toHaveBeenCalled();
  });

  it("CONFIRMED اليوم بعد حلول وقته ⇒ 200 وCOMPLETED مع endedAt وإشعار للمريض", async (ctx) => {
    const now = algeriaNowMinutes();
    if (now < 2) ctx.skip(); // أول دقيقة من اليوم: لا وقت سابق اليوم
    const a = await mkAppt(0, Math.max(0, now - 30));
    const r = await complete(a.id);
    expect(r.status).toBe(200);
    const after = await db.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.endedAt).not.toBeNull();
    expect(await db.notification.count({ where: { appointmentId: a.id, userId: ids.patientUser } })).toBe(1);
  });

  it("IN_PROGRESS أو LATE اليوم قبل الوقت الأصلي ⇒ 200 (المريض استُدعي فعليًا)", async (ctx) => {
    const now = algeriaNowMinutes();
    if (now > 23 * 60 + 50) ctx.skip();
    const inside = await mkAppt(0, Math.min(now + 40, 23 * 60 + 59), "IN_PROGRESS");
    expect((await complete(inside.id)).status).toBe(200);
    const late = await mkAppt(0, Math.min(now + 45, 23 * 60 + 59), "LATE");
    expect((await complete(late.id)).status).toBe(200);
    const rows = await db.appointment.findMany({ where: { id: { in: [inside.id, late.id] } } });
    expect(rows.map((x) => x.status)).toEqual(["COMPLETED", "COMPLETED"]);
  });

  it("يوم لاحق ⇒ 400 دون تغيير، ويوم سابق ⇒ 200 (القاعدة الحالية بلا تغيير)", async () => {
    const tomorrow = await mkAppt(1, 9 * 60);
    const r = await complete(tomorrow.id);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/لم يحن يومه/);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: tomorrow.id } })).status).toBe("CONFIRMED");

    const yesterday = await mkAppt(-1, 23 * 60);
    expect((await complete(yesterday.id)).status).toBe(200);
  });

  it("المساعد ما زال ممنوعًا من COMPLETED حتى بعد حلول الوقت", async (ctx) => {
    const now = algeriaNowMinutes();
    if (now < 2) ctx.skip();
    const a = await mkAppt(0, Math.max(0, now - 20));
    const r = await complete(a.id, assistantToken);
    expect(r.status).toBe(400);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONFIRMED");
  });
});
