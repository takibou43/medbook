/**
 * اختيار اليوم/الوقت الاختياري عند الحجز (PostgreSQL حقيقي عبر HTTP):
 * بلا اختيار → كما كان؛ يوم فقط؛ يوم + وقت بالضبط؛ يوم/وقت غير متاح → 409؛ تزامن على نفس الوقت → مريض
 * واحد فقط؛ إلغاء يحرّر الوقت لإعادة اختياره؛ والطابور/التذكيرات والحجز القديم (أقرب وقت بعد المطلوب) بلا تغيير.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run chosenSlot
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

const SLOT_MSG = "هذا الموعد لم يعد متاحًا، يرجى اختيار وقت آخر.";

/** يوم الجزائر بعد n يوم من اليوم (YYYY-MM-DD). */
function dayStr(n: number): string {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));
  return d.toISOString().slice(0, 10);
}
const dow = (s: string) => new Date(s + "T00:00:00Z").getUTCDay();

describe.skipIf(!TEST_URL)("اختيار اليوم والوقت الاختياري عند الحجز (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  const tag = `cs${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  const pool: { patientId: string; token: string }[] = [];
  let seq = 0;
  // يوم عطلة أسبوعي للطبيب: يوم الأسبوع الذي يقع فيه «بعد يومين».
  const OFF_DAY = dayStr(2);
  const OFF_DOW = dow(OFF_DAY);
  // أيام عمل للاختبارات (غد وما بعده، بلا يوم العطلة).
  const workDays = Array.from({ length: 20 }, (_, i) => dayStr(i + 1)).filter((d) => dow(d) !== OFF_DOW);

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined, details: j?.details };
  };

  async function mkDoctor() {
    const n = ++seq;
    const u = await db.user.create({ data: { email: `${tag}-d${n}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + n, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 15, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: {
          create: Array.from({ length: 7 }, (_, day) => day)
            .filter((day) => day !== OFF_DOW)
            .map((day) => ({ dayOfWeek: day, startTime: "09:00", endTime: "12:00" })),
        },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    return d.id;
  }
  async function mkPatient() {
    const n = ++seq;
    const reg = await call("POST", "/api/patient/auth/register", {
      email: `${tag}-p${n}@test.local`, password: "Secret123!", name: `مريض ${n}`, phone: `07${String(Date.now() + n).slice(-8)}`,
    });
    expect(reg.status).toBe(201);
    ids.users.push(reg.data.user.id);
    return { patientId: reg.data.user.patient.id as string, token: reg.data.accessToken as string };
  }
  const body = (doctorId: string, extra: Record<string, unknown> = {}) => ({
    firstName: "سارة", lastName: "بن يوسف", phone: "0551234567", wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId, ...extra,
  });
  const book = (doctorId: string, extra: Record<string, unknown> = {}, p = pool[0]) => call("POST", "/api/booking", body(doctorId, extra), p.token);
  const daySlots = async (doctorId: string, date: string) => (await call("GET", `/api/booking/availability?doctorId=${doctorId}&date=${date}`)).data.slots as string[];

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    process.env.REMINDERS_ENABLED = "false";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (let i = 0; i < 10; i++) pool.push(await mkPatient());
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: ids.doctors } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: ids.users } } });
    await db.patient.deleteMany({ where: { userId: { in: ids.users } } });
    await db.user.deleteMany({ where: { id: { in: ids.users } } });
    await db.specialty.deleteMany({ where: { id: ids.specialty } });
    await db.city.deleteMany({ where: { id: ids.city } });
    await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
    await db.$disconnect();
  });

  it("الأيام المعروضة = أيام عمل الطبيب الفعلية فقط (بلا يوم العطلة ولا يوم ممتلئ)، والأوقات = الشاغرة فقط", async () => {
    const d = await mkDoctor();
    // يوم ممتلئ بالكامل (12 خانة × 15 د) لا يُعرض.
    const full = workDays[1];
    for (let i = 0; i < 12; i++) {
      const m = 9 * 60 + i * 15;
      const hm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
      await db.appointment.create({ data: { doctorId: d, date: new Date(full + "T00:00:00Z"), startTime: hm(m), endTime: hm(m + 15), status: "CONFIRMED", guestFirstName: "ض" } });
    }
    const r = await call("GET", `/api/booking/availability?doctorId=${d}`);
    expect(r.status).toBe(200);
    const days = (r.data.days as { date: string }[]).map((x) => x.date);
    expect(days).not.toContain(OFF_DAY);
    expect(days.every((x) => dow(x) !== OFF_DOW)).toBe(true);
    expect(days).not.toContain(full);
    expect(days).toContain(workDays[0]);
    expect(r.data.slotMinutes).toBe(15);
    const slots = await daySlots(d, workDays[0]);
    expect(slots[0]).toBe("09:00");
    expect(slots).toHaveLength(12);
    expect(await daySlots(d, OFF_DAY)).toEqual([]);
  });

  it("1) بلا يوم ولا وقت → نفس الحجز الآلي السابق (أول دور متاح، مطابق لمعاينة next-slot)", async () => {
    const d = await mkDoctor();
    const preview = await call("GET", `/api/booking/next-slot?doctorId=${d}`);
    const r = await book(d);
    expect(r.status).toBe(201);
    expect(r.data.date.slice(0, 10)).toBe(preview.data.date);
    expect(r.data.startTime).toBe(preview.data.startTime);
    expect(r.data.status).toBe("CONFIRMED");
  });

  it("2) اليوم فقط → أول وقت شاغر في ذلك اليوم", async () => {
    const d = await mkDoctor();
    const day = workDays[2];
    await db.appointment.create({ data: { doctorId: d, date: new Date(day + "T00:00:00Z"), startTime: "09:00", endTime: "09:15", status: "CONFIRMED", guestFirstName: "ض" } });
    const r = await book(d, { date: day });
    expect(r.status).toBe(201);
    expect(r.data.date.slice(0, 10)).toBe(day);
    expect(r.data.startTime).toBe("09:15");
  });

  it("3) اليوم + الوقت → الموعد بالوقت المختار بالضبط، ولا يعود ظاهرًا في الأوقات", async () => {
    const d = await mkDoctor();
    const day = workDays[3];
    const r = await book(d, { date: day, startTime: "10:30", exactTime: true });
    expect(r.status).toBe(201);
    expect(r.data.startTime).toBe("10:30");
    expect(r.data.endTime).toBe("10:45");
    expect(await daySlots(d, day)).not.toContain("10:30");
  });

  it("4) يوم غير متاح (عطلة الطبيب، يوم مضى، خارج أفق الحجز) → 409 ولا يُنشأ موعد", async () => {
    const d = await mkDoctor();
    for (const date of [OFF_DAY, dayStr(-1), dayStr(90)]) {
      const r = await book(d, { date });
      expect(r.status).toBe(409);
      expect(r.details?.code).toBe("DAY_UNAVAILABLE");
      const r2 = await book(d, { date, startTime: "10:00", exactTime: true });
      expect(r2.status).toBe(409);
    }
    expect(await db.appointment.count({ where: { doctorId: d } })).toBe(0);
  });

  it("5) وقت غير متاح (محجوز، خارج الدوام، خارج شبكة مدة الجلسة) → 409 «هذا الموعد لم يعد متاحًا» ولا ينقله لوقت آخر", async () => {
    const d = await mkDoctor();
    const day = workDays[4];
    expect((await book(d, { date: day, startTime: "09:30", exactTime: true }, pool[0])).status).toBe(201);
    for (const startTime of ["09:30", "13:00", "08:45", "09:07"]) {
      const r = await book(d, { date: day, startTime, exactTime: true }, pool[1]);
      expect(r.status).toBe(409);
      expect(r.message).toBe(SLOT_MSG);
      expect(r.details?.code).toBe("SLOT_UNAVAILABLE");
    }
    expect(await db.appointment.count({ where: { doctorId: d } })).toBe(1);
  });

  it("6) نفس الوقت من 10 مرضى في نفس اللحظة → مريض واحد فقط يحصل عليه، والبقية 409", async () => {
    const d = await mkDoctor();
    const day = workDays[5];
    const results = await Promise.all(pool.map((p) => book(d, { date: day, startTime: "11:00", exactTime: true }, p)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.message === SLOT_MSG)).toHaveLength(pool.length - 1);
    expect(await db.appointment.count({ where: { doctorId: d, date: new Date(day + "T00:00:00Z"), startTime: "11:00", status: { not: "CANCELLED" } } })).toBe(1);
  });

  it("7) إلغاء موعد يحرّر وقته (activeSlot) فيظهر مجددًا ويمكن لمريض آخر اختياره", async () => {
    const d = await mkDoctor();
    const day = workDays[6];
    const first = await book(d, { date: day, startTime: "10:00", exactTime: true }, pool[2]);
    expect(first.status).toBe(201);
    expect(await daySlots(d, day)).not.toContain("10:00");
    expect((await call("DELETE", `/api/appointments/${first.data.id}`, undefined, pool[2].token)).status).toBe(200);
    expect(await daySlots(d, day)).toContain("10:00");
    const second = await book(d, { date: day, startTime: "10:00", exactTime: true }, pool[3]);
    expect(second.status).toBe(201);
    expect(second.data.startTime).toBe("10:00");
    const cancelled = await db.appointment.findUnique({ where: { id: first.data.id } });
    expect(cancelled).toMatchObject({ status: "CANCELLED", activeSlot: null });
  });

  it("8) لا تأثير على الطابور والتنبيهات ولا على الحجز القديم (وقت مطلوب بلا exactTime = أقرب وقت بعده)", async () => {
    const d = await mkDoctor();
    const day = workDays[7];
    const chosen = await book(d, { date: day, startTime: "09:00", exactTime: true }, pool[4]);
    expect(chosen.status).toBe(201);
    // السلوك السابق محفوظ: نفس الوقت بلا exactTime → يُعطى أقرب وقت بعده بدل الرفض.
    const legacy = await book(d, { date: day, startTime: "09:00" }, pool[5]);
    expect(legacy.status).toBe(201);
    expect(legacy.data.startTime).toBe("09:15");
    expect(legacy.data.shiftedFromRequested).toBe(true);
    // الموعد المختار موعد عادي: CONFIRMED مرتبط بالمريض، وتُنشأ له سجلات التذكير كالمعتاد.
    const appt = await db.appointment.findUniqueOrThrow({ where: { id: chosen.data.id } });
    expect(appt).toMatchObject({ status: "CONFIRMED", patientId: pool[4].patientId, skipCredits: 0, deferredCount: 0 });
    const reminders = await import("../../src/modules/reminders/reminders.service");
    const start = reminders.appointmentStartUtc(appt.date, appt.startTime);
    await reminders.ensureReminderRows(new Date(start.getTime() - 90 * 60_000));
    expect((await db.appointmentReminder.findMany({ where: { appointmentId: appt.id } })).map((r) => r.type).sort()).toEqual(["FIVE_MINUTES", "ONE_HOUR"]);
    // وفي «حالة دوري» (طابور يومه) يظهر بالترتيب الطبيعي.
    const status = await call("GET", `/api/booking/status/${appt.id}`);
    expect(status.status).toBe(200);
    expect(status.data.startTime).toBe("09:00");
  });
});
