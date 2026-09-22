/**
 * «متأخر» في الطابور على PostgreSQL حقيقي عبر HTTP (Express + JWT + الصلاحيات + المعاملات الحقيقية):
 * +2 ثم +4، منع التكرار (متتاليًا ومتزامنًا)، الإشعار للمريض صاحب الموعد فقط، عدم تأثير فشل Push،
 * الحالات النهائية، صلاحيات الطبيب/المساعد/المريض، ومسار PATCH العام.
 * خدمة الدفع وحدها (web-push) مستبدلة. تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run lateQueue
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!TEST_URL)("متأخر في الطابور (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let sign: (p: { sub: string; role: any }) => string;
  let today: Date;
  const tag = `lq${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  let docA: { id: string; token: string };
  let docB: { id: string; token: string };
  let assistantToken = "";
  let patient: { userId: string; patientId: string; token: string };

  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message };
  };

  async function mkUser(role: string, suffix: string) {
    const u = await db.user.create({ data: { email: `${tag}-${suffix}@test.local`, passwordHash: "x", role: role as any } });
    ids.users.push(u.id);
    return u;
  }
  async function mkDoctor(suffix: string) {
    const u = await mkUser("DOCTOR", suffix);
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + suffix, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 5, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, day) => ({ dayOfWeek: day, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    ids.doctors.push(d.id);
    return { id: d.id, token: sign({ sub: u.id, role: "DOCTOR" }) };
  }

  /** طابور اليوم لطبيب: أسماء بترتيب المواعيد. أول اسم يمكن ربطه بحساب المريض. */
  async function seedQueue(doctorId: string, names: string[], linkFirstToPatient = false) {
    await db.appointment.deleteMany({ where: { doctorId } });
    const created: Record<string, string> = {};
    for (let i = 0; i < names.length; i++) {
      const a = await db.appointment.create({
        data: {
          doctorId, date: today, startTime: `00:${String(10 + i).padStart(2, "0")}`, endTime: `00:${String(11 + i).padStart(2, "0")}`,
          status: "CONFIRMED", guestFirstName: names[i], guestLastName: "اختبار",
          patientId: linkFirstToPatient && i === 0 ? patient.patientId : null,
        },
      });
      created[names[i]] = a.id;
    }
    return created;
  }
  const byId = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  async function orderedNames(token: string, map: Record<string, string>) {
    const q = await call("GET", "/api/appointments/queue", token);
    const names = byId(map);
    return (q.data.ordered as any[]).map((a) => names[a.id]);
  }
  const next = async (token: string) => (await call("POST", "/api/appointments/queue/next", token)).data?.id as string;
  const late = (id: string, token: string) => call("POST", `/api/appointments/${id}/late`, token);
  const finish = (id: string, token: string) => call("PATCH", `/api/appointments/${id}`, token, { status: "COMPLETED" });

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    today = (await import("../../src/lib/slots")).algeriaTodayUTCMidnight();
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });
    docA = await mkDoctor("a");
    docB = await mkDoctor("b");
    const au = await mkUser("ASSISTANT", "asst");
    await db.assistant.create({ data: { userId: au.id, doctorId: docA.id, firstName: "مساعد", lastName: tag } });
    assistantToken = sign({ sub: au.id, role: "ASSISTANT" });
    const pu = await mkUser("PATIENT", "patient");
    const p = await db.patient.create({ data: { userId: pu.id, firstName: "أحمد", lastName: "المريض" } });
    await db.pushSubscription.create({ data: { userId: pu.id, endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`, p256dh: "k", auth: "a" } });
    patient = { userId: pu.id, patientId: p.id, token: sign({ sub: pu.id, role: "PATIENT" }) };
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    await db.appointmentLateEvent.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.smsLog.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.pushSubscription.deleteMany({ where: { userId: { in: ids.users } } });
    await db.assistant.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: ids.doctors } } });
    await db.user.deleteMany({ where: { id: { in: ids.users } } });
    await db.specialty.deleteMany({ where: { id: ids.specialty } });
    await db.city.deleteMany({ where: { id: ids.city } });
    await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
    await db.$disconnect();
  });

  beforeEach(() => {
    h.sendNotification.mockReset();
    h.sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  it("A..F: التأخير الأول +2 ثم الثاني +4، والمريض يبقى في الطابور (ليس NO_SHOW)", async () => {
    const m = await seedQueue(docA.id, ["A", "B", "C", "D", "E", "F"], true);
    expect(await next(docA.token)).toBe(m.A);

    const r1 = await late(m.A, docA.token);
    expect(r1.status).toBe(200);
    expect(r1.data).toMatchObject({ status: "LATE", deferredCount: 1, skipCredits: 2, duplicate: false });
    expect(r1.data.lateEvent).toMatchObject({ sequence: 1, penalty: 2 });
    expect(await orderedNames(docA.token, m)).toEqual(["B", "C", "A", "D", "E", "F"]);

    for (const n of ["B", "C"]) {
      expect(await next(docA.token)).toBe(m[n]);
      expect((await finish(m[n], docA.token)).status).toBe(200);
    }
    expect(await next(docA.token)).toBe(m.A);
    const r2 = await late(m.A, docA.token);
    expect(r2.data).toMatchObject({ status: "LATE", deferredCount: 2, skipCredits: 4 });
    expect(r2.data.lateEvent).toMatchObject({ sequence: 2, penalty: 4 });
    // لم يبق بعده إلا 3 مرضى: يعود بعدهم مباشرة (لا يتجاوز حدود الطابور)
    expect(await orderedNames(docA.token, m)).toEqual(["D", "E", "F", "A"]);

    const events = await db.appointmentLateEvent.findMany({ where: { appointmentId: m.A }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => [e.sequence, e.penalty])).toEqual([[1, 2], [2, 4]]);
    const a = await db.appointment.findUnique({ where: { id: m.A } });
    expect(a!.status).toBe("LATE");
  });

  it("A..H: A +2 ثم B +2 ثم A +4 — ترتيب صحيح بلا تكرار ولا فقدان", async () => {
    const m = await seedQueue(docA.id, ["A", "B", "C", "D", "E", "F", "G", "H"]);
    await next(docA.token);
    await late(m.A, docA.token);
    await next(docA.token); // B
    await late(m.B, docA.token);
    expect(await orderedNames(docA.token, m)).toEqual(["C", "A", "B", "D", "E", "F", "G", "H"]);
    expect(await next(docA.token)).toBe(m.C);
    await finish(m.C, docA.token);
    expect(await next(docA.token)).toBe(m.A);
    await late(m.A, docA.token);
    const order = await orderedNames(docA.token, m);
    expect(order).toEqual(["B", "D", "E", "F", "A", "G", "H"]);
    expect(new Set(order).size).toBe(7);
  });

  it("25+17) نفس الطلب مرتين ثم 10 طلبات متزامنة: حدث واحد، lateCount = 1، إشعار واحد", async () => {
    const m = await seedQueue(docA.id, ["A", "B", "C"], true);
    await next(docA.token);
    const first = await late(m.A, docA.token);
    const again = await late(m.A, docA.token);
    expect(first.data.duplicate).toBe(false);
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ duplicate: true, deferredCount: 1, skipCredits: 2 });

    // مناداته من جديد ثم 10 ضغطات متزامنة (طبيب + مساعد معًا)
    await call("POST", `/api/appointments/${m.A}/call`, docA.token);
    const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => late(m.A, i % 2 ? assistantToken : docA.token)));
    expect(burst.every((r) => r.status === 200)).toBe(true);
    expect(burst.filter((r) => r.data.duplicate === false)).toHaveLength(1);
    const a = await db.appointment.findUnique({ where: { id: m.A } });
    expect(a).toMatchObject({ status: "LATE", deferredCount: 2, skipCredits: 4 });
    expect(await db.appointmentLateEvent.count({ where: { appointmentId: m.A } })).toBe(2);

    await sleep(300);
    // إشعاران فقط (حدثان حقيقيان) رغم 12 طلبًا
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("26) Push: يصل للمريض صاحب الموعد فقط، بنص بلا بيانات طبية، ومرتبط بالحدث", async () => {
    const m = await seedQueue(docA.id, ["A", "B"], true);
    await next(docA.token);
    const r = await late(m.A, docA.token);
    await sleep(300);
    expect(h.sendNotification).toHaveBeenCalledTimes(1);
    const [sub, payloadRaw] = h.sendNotification.mock.calls[0] as any[];
    expect(sub.endpoint).toContain(tag);
    const payload = JSON.parse(payloadRaw);
    expect(payload.title).toBe("🔔 تنبيه بخصوص موعدك");
    expect(payload.body).toContain("ما زلت في قائمة الانتظار");
    expect(payload.tag).toBe(`late-${r.data.lateEvent.id}`);
    expect(payload.url).toBe(`/account?appointment=${m.A}`);
  });

  it("26) مريض ضيف بلا حساب/بلا اشتراك: التأخير ينجح بلا أي إشعار", async () => {
    const m = await seedQueue(docA.id, ["A", "B"]);
    await next(docA.token);
    expect((await late(m.A, docA.token)).status).toBe(200);
    await sleep(200);
    expect(h.sendNotification).not.toHaveBeenCalled();
  });

  it("26) فشل Push (500) أو اشتراك منتهٍ (410): التأخير محفوظ ولا rollback", async () => {
    h.sendNotification.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    const m = await seedQueue(docA.id, ["A", "B", "C"], true);
    await next(docA.token);
    const r = await late(m.A, docA.token);
    expect(r.status).toBe(200);
    await sleep(200);
    expect((await db.appointment.findUnique({ where: { id: m.A } }))!.status).toBe("LATE");

    h.sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    await call("POST", `/api/appointments/${m.A}/call`, docA.token);
    expect((await late(m.A, docA.token)).status).toBe(200);
    await sleep(300);
    expect((await db.appointment.findUnique({ where: { id: m.A } }))!.deferredCount).toBe(2);
    // الاشتراك الميت حُذف تلقائيًا — نعيده لبقية الاختبارات
    expect(await db.pushSubscription.count({ where: { userId: patient.userId } })).toBe(0);
    await db.pushSubscription.create({ data: { userId: patient.userId, endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`, p256dh: "k", auth: "a" } });
  });

  it("28) COMPLETED / CANCELLED / NO_SHOW لا تُسجَّل متأخرة ولا تعود للطابور", async () => {
    const m = await seedQueue(docA.id, ["A", "B", "C", "D"]);
    await db.appointment.update({ where: { id: m.A }, data: { status: "COMPLETED" } });
    await db.appointment.update({ where: { id: m.B }, data: { status: "CANCELLED" } });
    await db.appointment.update({ where: { id: m.C }, data: { status: "NO_SHOW" } });
    for (const n of ["A", "B", "C"]) expect((await late(m[n], docA.token)).status).toBe(400);
    expect(await orderedNames(docA.token, m)).toEqual(["D"]);
    expect(await db.appointmentLateEvent.count({ where: { appointmentId: { in: [m.A, m.B, m.C] } } })).toBe(0);
  });

  it("18+33) الصلاحيات: المساعد يستطيع، المريض والطبيب الآخر لا، وبلا توكن 401", async () => {
    const m = await seedQueue(docA.id, ["A", "B"], true);
    await next(docA.token);
    expect((await late(m.A)).status).toBe(401);
    expect((await late(m.A, patient.token)).status).toBe(403);
    expect((await late(m.A, docB.token)).status).toBe(403);
    // المريض لا يستطيع تغيير الحالة إلى LATE عبر PATCH العام أيضًا
    expect((await call("PATCH", `/api/appointments/${m.A}`, patient.token, { status: "LATE" })).status).not.toBe(200);
    expect((await db.appointment.findUnique({ where: { id: m.A } }))!.status).toBe("IN_PROGRESS");
    const byAssistant = await late(m.A, assistantToken);
    expect(byAssistant.data).toMatchObject({ status: "LATE", skipCredits: 2 });
  });

  it("19) العقد الحالي للـAPI محفوظ: «متأخر» عبر POST /:id/late فقط، و PATCH لا يقبل LATE (400) ولا يُنشئ حدثًا", async () => {
    const m = await seedQueue(docA.id, ["A", "B", "C"]);
    await next(docA.token);
    const r = await call("PATCH", `/api/appointments/${m.A}`, docA.token, { status: "LATE" });
    expect(r.status).toBe(400);
    expect((await db.appointment.findUnique({ where: { id: m.A } }))!.status).toBe("IN_PROGRESS");
    expect(await db.appointmentLateEvent.count({ where: { appointmentId: m.A } })).toBe(0);
  });

  it("27) موعد قديم (قبل الميزة) متأخر بعدّاد سابق وبلا أحداث: يبقى في الطابور والتأخير التالي +4", async () => {
    const m = await seedQueue(docA.id, ["A", "B", "C", "D", "E", "F"]);
    await db.appointment.update({ where: { id: m.A }, data: { status: "LATE", deferredCount: 1, skipCredits: 0 } });
    expect((await orderedNames(docA.token, m))[0]).toBe("A");
    expect(await next(docA.token)).toBe(m.A);
    const r = await late(m.A, docA.token);
    expect(r.data).toMatchObject({ deferredCount: 2, skipCredits: 4 });
    expect(await orderedNames(docA.token, m)).toEqual(["B", "C", "D", "E", "A", "F"]);
  });

  it("30) حالة الدور للمريض تعرض ترتيبه الجديد بعد التأخير", async () => {
    const m = await seedQueue(docA.id, ["A", "B", "C", "D"]);
    await next(docA.token);
    await late(m.A, docA.token);
    const s = await call("GET", `/api/booking/status/${m.A}`);
    expect(s.data).toMatchObject({ status: "LATE", aheadOfYou: 2, position: 3 });
  });
});
