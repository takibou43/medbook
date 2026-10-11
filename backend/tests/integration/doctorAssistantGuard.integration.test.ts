/**
 * منع حجز الطبيب حين يكون لديه مساعد فعلي — على PostgreSQL حقيقي عبر HTTP (Express + JWT + المعاملات والأقفال):
 *  - طبيب بلا مساعد: POST /api/doctor/appointments/guest ⇒ 201.
 *  - طبيب لديه مساعد فعّال: ⇒ 403 برسالة عربية ولا يُنشأ موعد (لا يكفي إخفاء الزر).
 *  - مساعد معطَّل أو حساب مساعد معطَّل أو سجل محذوف أو دعوة معلّقة: لا يُحتسب ⇒ الحجز مسموح.
 *  - إضافة مساعد تمنع الحجز، وتعطيل/حذف آخر مساعد يعيده.
 *  - المساعد ينشئ walk-in لطبيبه (201)؛ والحجز الذاتي للمريض لا يتأثر (201) رغم وجود مساعد.
 *  - GET /api/doctor/dashboard يعيد canCreateAppointments وsubscription من الخادم.
 *  - تزامن: تفعيل مساعد عبر الـ API أثناء طلبات حجز متزامنة ⇒ لا 5xx، وكل طلب بعد تثبيت التفعيل ⇒ 403.
 * خدمة الدفع وحدها (web-push) مستبدلة. تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run doctorAssistantGuard
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "http";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.REMINDERS_ENABLED = "false";
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({ statusCode: 201 })) } }));

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}
const MSG = "لا يمكنك إنشاء موعد أثناء وجود مساعد مسؤول عن الحجوزات.";

/** يوم الجزائر بعد n يوم من اليوم (YYYY-MM-DD). */
function dayStr(n: number): string {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n)).toISOString().slice(0, 10);
}

describe.skipIf(!TEST_URL)("منع حجز الطبيب عند وجود مساعد (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let signAccessToken: (p: any) => string;
  const tag = `dag${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  let seq = 0;

  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined };
  };

  async function mkDoctor() {
    const n = ++seq;
    const u = await db.user.create({ data: { email: `${tag}-d${n}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + n, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city, slotDurationMin: 15,
        verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, k) => ({ dayOfWeek: k, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    return { doctorId: d.id, userId: u.id, token: signAccessToken({ sub: u.id, role: "DOCTOR" }) };
  }
  async function mkAssistant(doctorId: string, over: { isActive?: boolean; userActive?: boolean } = {}) {
    const n = ++seq;
    const u = await db.user.create({ data: { email: `${tag}-a${n}@test.local`, passwordHash: "x", role: "ASSISTANT", isActive: over.userActive ?? true } });
    const a = await db.assistant.create({ data: { userId: u.id, doctorId, firstName: "م" + n, lastName: tag, isActive: over.isActive ?? true } });
    ids.users.push(u.id);
    return { assistantId: a.id, userId: u.id, token: signAccessToken({ sub: u.id, role: "ASSISTANT" }) };
  }
  let slotSeq = 0;
  /** وقت فريد لكل طلب (شبكة 15 دقيقة في اليوم) حتى لا تتعارض الحجوزات فيما بينها. */
  const nextTime = () => {
    const i = slotSeq++;
    return `${String(Math.floor(i / 4) % 24).padStart(2, "0")}:${["00", "15", "30", "45"][i % 4]}`;
  };
  const guest = (token: string, over: Record<string, unknown> = {}) =>
    call("POST", "/api/doctor/appointments/guest", token, {
      firstName: "زائر", lastName: tag, phone: "0551234567", date: dayStr(2), startTime: nextTime(), idempotencyKey: randomUUID(), ...over,
    });
  const count = (doctorId: string) => db.appointment.count({ where: { doctorId } });

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });
    ({ signAccessToken } = await import("../../src/utils/jwt"));
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);

  afterAll(async () => {
    server?.close();
    if (db) {
      await db.appointmentFinancial.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } }).catch(() => undefined);
      await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
      await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
      await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
      await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
      await db.assistantInvite.deleteMany({ where: { doctorId: { in: ids.doctors } } });
      await db.assistant.deleteMany({ where: { doctorId: { in: ids.doctors } } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids.doctors } } });
      await db.doctor.deleteMany({ where: { id: { in: ids.doctors } } });
      await db.patient.deleteMany({ where: { userId: { in: ids.users } } });
      await db.user.deleteMany({ where: { id: { in: ids.users } } });
      await db.specialty.deleteMany({ where: { id: ids.specialty } });
      await db.city.deleteMany({ where: { id: ids.city } });
      await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
      await db.$disconnect();
    }
  });

  it("1) طبيب بلا مساعد يحجز لمريض دون حساب ⇒ 201، وlist الداشبورد يسمح", async () => {
    const d = await mkDoctor();
    const dash = await call("GET", "/api/doctor/dashboard", d.token);
    expect(dash.status).toBe(200);
    expect(dash.data.canCreateAppointments).toBe(true);
    expect(dash.data.hasActiveAssistant).toBe(false);
    const r = await guest(d.token);
    expect(r.status).toBe(201);
    expect(await count(d.doctorId)).toBe(1);
  });

  it("2) طبيب لديه مساعد فعّال ⇒ 403 برسالة عربية ولا يُنشأ موعد، والداشبورد يخفي الإجراء", async () => {
    const d = await mkDoctor();
    await mkAssistant(d.doctorId);
    const r = await guest(d.token);
    expect(r.status).toBe(403);
    expect(r.message).toBe(MSG);
    expect(await count(d.doctorId)).toBe(0);
    const dash = await call("GET", "/api/doctor/dashboard", d.token);
    expect(dash.data.canCreateAppointments).toBe(false);
    expect(dash.data.hasActiveAssistant).toBe(true);
    // بقية الوظائف تبقى: عرض المواعيد والطابور.
    expect((await call("GET", "/api/appointments", d.token)).status).toBe(200);
    expect((await call("GET", "/api/appointments/queue", d.token)).status).toBe(200);
  });

  it("3) المحاولة نفسها بمفتاح طلب مختلف أو بوقت آخر تبقى 403 (لا التفاف عبر idempotencyKey)", async () => {
    const d = await mkDoctor();
    await mkAssistant(d.doctorId);
    for (let i = 0; i < 3; i++) expect((await guest(d.token)).status).toBe(403);
    expect(await count(d.doctorId)).toBe(0);
  });

  it("4) مساعد معطَّل، أو حساب مساعد معطَّل، لا يُحتسبان ⇒ الحجز مسموح", async () => {
    const d1 = await mkDoctor();
    await mkAssistant(d1.doctorId, { isActive: false });
    expect((await guest(d1.token)).status).toBe(201);
    const d2 = await mkDoctor();
    await mkAssistant(d2.doctorId, { userActive: false });
    expect((await guest(d2.token)).status).toBe(201);
  });

  it("5) دعوة معلّقة وحدها ليست مساعدًا ⇒ الحجز مسموح", async () => {
    const d = await mkDoctor();
    await db.assistantInvite.create({ data: { doctorId: d.doctorId, email: `${tag}-inv@test.local`, tokenHash: randomUUID() + randomUUID(), expiresAt: new Date(Date.now() + 86400000) } });
    expect((await guest(d.token)).status).toBe(201);
  });

  it("6) إضافة مساعد تعطّل الحجز، وتعطيل/حذف آخر مساعد عبر الـ API يعيده", async () => {
    const d = await mkDoctor();
    expect((await guest(d.token)).status).toBe(201);
    const a = await mkAssistant(d.doctorId);
    expect((await guest(d.token)).status).toBe(403);
    // تعطيل عبر الـ API الفعلي (وهو يأخذ قفل الطابور).
    const off = await call("PATCH", `/api/doctor/assistants/${a.assistantId}/status`, d.token, { isActive: false });
    expect(off.status).toBe(200);
    expect((await guest(d.token)).status).toBe(201);
    const on = await call("PATCH", `/api/doctor/assistants/${a.assistantId}/status`, d.token, { isActive: true });
    expect(on.status).toBe(200);
    expect((await guest(d.token)).status).toBe(403);
    await db.assistant.delete({ where: { id: a.assistantId } });
    expect((await guest(d.token)).status).toBe(201);
  });

  it("7) المساعد ينشئ walk-in لطبيبه ⇒ 201، ولا يستطيع المساعد الحجز عبر مسار الطبيب (403)", async () => {
    const d = await mkDoctor();
    const a = await mkAssistant(d.doctorId);
    const w = await call("POST", "/api/appointments/walk-in", a.token, { firstName: "زائر", lastName: tag, phone: "0551234568", idempotencyKey: randomUUID() });
    expect(w.status).toBe(201);
    const viaDoctorRoute = await guest(a.token);
    expect([401, 403]).toContain(viaDoctorRoute.status);
  });

  it("8) مساعد طبيب آخر لا يحجز لهذا الطبيب", async () => {
    const d1 = await mkDoctor();
    const d2 = await mkDoctor();
    const a2 = await mkAssistant(d2.doctorId);
    // الترويسة لا تُغيّر الطبيب الفعلي للمساعد المستقل: يبقى مقيدًا بطبيبه وحده.
    const w = await call("POST", "/api/appointments/walk-in", a2.token, { firstName: "زائر", lastName: tag, phone: "0551234569", idempotencyKey: randomUUID() });
    expect(w.status).toBe(201);
    expect(await count(d1.doctorId)).toBe(0);
    expect(await count(d2.doctorId)).toBe(1);
  });

  it("9) الحجز الذاتي للمريض لا يتأثر بوجود مساعد", async () => {
    const d = await mkDoctor();
    await mkAssistant(d.doctorId);
    const n = ++seq;
    const reg = await call("POST", "/api/patient/auth/register", undefined, {
      email: `${tag}-p${n}@test.local`, password: "Secret123!", name: `مريض ${n}`, phone: `07${String(Date.now() + n).slice(-8)}`,
    });
    expect(reg.status).toBe(201);
    ids.users.push(reg.data.user.id);
    const r = await call("POST", "/api/appointments", reg.data.accessToken, { doctorId: d.doctorId, date: dayStr(2), startTime: "10:00" });
    expect(r.status).toBe(201);
  });

  it("10) تزامن: تفعيل مساعد أثناء طلبات حجز متزامنة ⇒ لا 5xx، وما بعد التفعيل كله 403", async () => {
    const d = await mkDoctor();
    const a = await mkAssistant(d.doctorId, { isActive: false });
    const flips = call("PATCH", `/api/doctor/assistants/${a.assistantId}/status`, d.token, { isActive: true });
    const attempts = await Promise.all([flips, ...Array.from({ length: 8 }, () => guest(d.token))]);
    expect(attempts[0].status).toBe(200);
    for (const r of attempts.slice(1)) expect([201, 403]).toContain(r.status);
    const created = attempts.slice(1).filter((r) => r.status === 201).length;
    expect(await count(d.doctorId)).toBe(created);
    // بعد أن ثبّت التفعيل: كل طلب جديد مرفوض ولا يزيد العدد.
    for (let i = 0; i < 3; i++) expect((await guest(d.token)).status).toBe(403);
    expect(await count(d.doctorId)).toBe(created);
  });

  it("11) الداشبورد يعيد ملخص اشتراك حقيقيًا (بلا مدة مخترعة) ويُحجب عن المساعد", async () => {
    const d = await mkDoctor();
    const a = await mkAssistant(d.doctorId);
    const dash = await call("GET", "/api/doctor/dashboard", d.token);
    expect(dash.data.subscription).toMatchObject({ active: true, clinicName: null });
    expect(["ACTIVE", "TRIAL"]).toContain(dash.data.subscription.kind);
    expect(dash.data.subscription.expiresAt).toBeNull(); // المصدر لم يضبط تاريخًا ⇒ لا نخترع واحدًا
    const asst = await call("GET", "/api/doctor/dashboard", a.token);
    expect(asst.status).toBe(200);
    expect(asst.data.subscription).toBeUndefined();
    expect(asst.data.canCreateAppointments).toBeUndefined();
    expect(asst.data.subscriptionStatus).toBeUndefined();
  });
});
