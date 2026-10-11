/**
 * أولوية موعد العودة الطبي في الطابور — على PostgreSQL حقيقي عبر HTTP (Express + JWT + المعاملات والأقفال):
 *  - ترحيل البيانات القديمة (backfillFollowUpFlag): يعلّم فقط مواعيد العودة المثبتة، ويعاد بلا أثر.
 *  - إنشاء موعد عودة عبر الـAPI يضبط isFollowUp، والوقت يبقى HH:mm.
 *  - تعارض الوقت: موعد العودة يأخذ أقرب وقت شاغر بعد المطلوب، ولا يُحذف أو يُعدَّل أو يُلغى الحجز السابق.
 *  - الترتيب والمناداة: موعد العودة الحاضر يتقدم لكنه لا يتجاوز التالي مباشرة (مرساة محفوظة عند الحضور)،
 *    وبعد مناداة صاحب المرساة يُنادى هو (تقدّم حقيقي)، ولا يتجاوز مريضًا أُرسل له «دورك اقترب» (SENT/PROCESSING فقط).
 *  - عقوبة التأخير باقية: موعد عودة LATE بلا أولوية.
 *  - الصلاحيات: المساعد لا ينشئ موعد عودة (403)؛ الطبيب يستطيع حتى مع مساعد، والحجز العادي له يبقى ممنوعًا.
 *  - التزامن: حجوزات المرضى وجدولة العودة معًا لنفس الوقت ⇒ لا تكرار ولا فقدان ولا 5xx.
 * خدمة الدفع وحدها (web-push) مستبدلة. تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run followUpQueuePriority
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
const HHMM = /^\d{2}:\d{2}$/;

function dayStr(n: number): string {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n)).toISOString().slice(0, 10);
}

describe.skipIf(!TEST_URL)("أولوية موعد العودة في الطابور (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let signAccessToken: (p: any) => string;
  let today: Date;
  const tag = `fqp${Date.now().toString(36)}`;
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

  async function mkDoctor(withAssistant = false) {
    const n = ++seq;
    const u = await db.user.create({ data: { email: `${tag}-d${n}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + n, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city, slotDurationMin: 15,
        dutyEndsAt: new Date(Date.now() + 8 * 3600_000), verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, k) => ({ dayOfWeek: k, startTime: "00:00", endTime: "23:59" })) },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    let assistantToken = "";
    if (withAssistant) {
      const au = await db.user.create({ data: { email: `${tag}-a${n}@test.local`, passwordHash: "x", role: "ASSISTANT" } });
      await db.assistant.create({ data: { userId: au.id, doctorId: d.id, firstName: "م" + n, lastName: tag, isActive: true } });
      ids.users.push(au.id);
      assistantToken = signAccessToken({ sub: au.id, role: "ASSISTANT" });
    }
    return { doctorId: d.id, token: signAccessToken({ sub: u.id, role: "DOCTOR" }), assistantToken };
  }

  let minute = 8 * 60;
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  /** موعد اليوم لطبيب: حاضر افتراضيًا. الأوقات تتزايد فلا تتعارض. */
  async function mkToday(doctorId: string, name: string, o: Record<string, unknown> = {}) {
    const m = (minute += 15);
    return db.appointment.create({
      data: {
        doctorId, date: today, startTime: hhmm(m), endTime: hhmm(m + 15), status: "CONFIRMED", arrivedAt: new Date(),
        guestFirstName: name, guestLastName: tag, guestPhone: "0551234567", ...o,
      },
    });
  }
  async function reset(doctorId: string) {
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId } } });
    await db.appointment.deleteMany({ where: { doctorId } });
    await db.doctor.update({ where: { id: doctorId }, data: { dutyEndsAt: new Date(Date.now() + 8 * 3600_000), queueRequestedAt: null } });
  }
  const order = async (token: string) => {
    const q = await call("GET", "/api/appointments/queue", token);
    expect(q.status).toBe(200);
    return (q.data.ordered as { id: string }[]).map((a) => a.id);
  };
  const arrive = (token: string, id: string) => call("POST", `/api/appointments/${id}/arrived`, token);
  const callNext = (token: string) => call("POST", "/api/appointments/queue/next", token);
  const notify = (appointmentId: string, status: string) =>
    db.appointmentReminder.create({ data: { appointmentId, type: "QUEUE_APPROACH", scheduledFor: new Date(), status: status as any } });

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
    today = (await import("../../src/lib/slots")).algeriaTodayUTCMidnight();
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
      await db.appointment.updateMany({ where: { doctorId: { in: ids.doctors } }, data: { parentAppointmentId: null } });
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

  // ---------------- الترحيل ----------------
  it("1) الترحيل يعلّم مواعيد العودة المثبتة فقط، ولا يغيّر وقتًا ولا حالة، ويعاد بلا أثر", async () => {
    const { backfillFollowUpFlag } = await import("../../src/lib/backfillFollowUpFlag");
    const d = await mkDoctor();
    const parent = await mkToday(d.doctorId, "أصل", { status: "COMPLETED" });
    const mk = (name: string, o: Record<string, unknown>) =>
      db.appointment.create({
        data: {
          doctorId: d.doctorId, date: new Date(today.getTime() + 86400000 * 3), startTime: hhmm((minute += 15)), endTime: hhmm(minute + 15),
          status: "CONFIRMED", guestFirstName: name, guestLastName: tag, guestPhone: "0551234567", ...o,
        },
      });
    const legacyFollowUp = await mk("عودة", { parentAppointmentId: parent.id, createdBy: "DOCTOR", type: "FOLLOW_UP" });
    const patientWithParent = await mk("مريض", { parentAppointmentId: parent.id, createdBy: "PATIENT", type: "IN_PERSON" });
    const plain = await mk("عادي", { createdBy: "DOCTOR", type: "IN_PERSON" });
    const before = await db.appointment.findMany({ where: { id: { in: [legacyFollowUp.id, patientWithParent.id, plain.id] } }, orderBy: { id: "asc" } });
    expect(before.every((r) => r.isFollowUp === false)).toBe(true);

    expect(await backfillFollowUpFlag(db)).toBeGreaterThanOrEqual(1);
    const after = await db.appointment.findMany({ where: { id: { in: [legacyFollowUp.id, patientWithParent.id, plain.id] } }, orderBy: { id: "asc" } });
    const flag = (id: string) => after.find((r) => r.id === id)!.isFollowUp;
    expect(flag(legacyFollowUp.id)).toBe(true);
    expect(flag(patientWithParent.id)).toBe(false);
    expect(flag(plain.id)).toBe(false);
    for (const b of before) {
      const a = after.find((r) => r.id === b.id)!;
      expect({ startTime: a.startTime, endTime: a.endTime, status: a.status, date: a.date }).toEqual({ startTime: b.startTime, endTime: b.endTime, status: b.status, date: b.date });
    }
    expect(await backfillFollowUpFlag(db)).toBe(0);
  });

  // ---------------- الإنشاء والتعارض ----------------
  it("2) إنشاء موعد عودة عبر الـAPI يضبط isFollowUp والوقت HH:mm، ولا يمس الموعد الأصلي", async () => {
    const d = await mkDoctor();
    const parent = await mkToday(d.doctorId, "أصل", { status: "COMPLETED" });
    const r = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, d.token, { date: dayStr(2), startTime: "10:00", idempotencyKey: randomUUID() });
    expect(r.status).toBe(201);
    expect(r.data.startTime).toMatch(HHMM);
    expect(r.data.shiftedFromRequested).toBe(false);
    const row = await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } });
    expect(row.isFollowUp).toBe(true);
    expect(row.parentAppointmentId).toBe(parent.id);
    expect(row.startTime).toMatch(HHMM);
    const parentAfter = await db.appointment.findUniqueOrThrow({ where: { id: parent.id } });
    expect(parentAfter.status).toBe("COMPLETED");
    expect(parentAfter.isFollowUp).toBe(false);
  });

  it("3) تعارض الوقت: موعد العودة يأخذ أقرب وقت شاغر ولا يُحذف الحجز السابق ولا يُعدَّل ولا يُلغى", async () => {
    const d = await mkDoctor();
    const parent = await mkToday(d.doctorId, "أصل", { status: "COMPLETED" });
    const booked = await db.appointment.create({
      data: { doctorId: d.doctorId, date: new Date(`${dayStr(3)}T00:00:00Z`), startTime: "10:00", endTime: "10:15", status: "CONFIRMED", guestFirstName: "سابق", guestLastName: tag, guestPhone: "0551234567" },
    });
    const r = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, d.token, { date: dayStr(3), startTime: "10:00", idempotencyKey: randomUUID() });
    expect(r.status).toBe(201);
    expect(r.data.startTime).toBe("10:15");
    expect(r.data.requestedStartTime).toBe("10:00");
    expect(r.data.shiftedFromRequested).toBe(true);
    const still = await db.appointment.findUniqueOrThrow({ where: { id: booked.id } });
    expect({ startTime: still.startTime, status: still.status, endTime: still.endTime }).toEqual({ startTime: "10:00", status: "CONFIRMED", endTime: "10:15" });
    expect(still.isFollowUp).toBe(false);
  });

  // ---------------- الطابور والمناداة ----------------
  it("4) موعد العودة الحاضر يتقدم لكنه لا يتجاوز التالي مباشرة، وبعد مناداة صاحب المرساة يُنادى هو", async () => {
    const d = await mkDoctor();
    await reset(d.doctorId);
    const n1 = await mkToday(d.doctorId, "ن1");
    const n2 = await mkToday(d.doctorId, "ن2");
    const n3 = await mkToday(d.doctorId, "ن3");
    const f = await mkToday(d.doctorId, "عودة", { isFollowUp: true, arrivedAt: null });
    expect((await order(d.token)).slice(0, 3)).toEqual([n1.id, n2.id, n3.id]);

    expect((await arrive(d.token, f.id)).status).toBe(200);
    const stored = await db.appointment.findUniqueOrThrow({ where: { id: f.id } });
    expect(stored.followUpAnchorId).toBe(n1.id);
    expect(await order(d.token)).toEqual([n1.id, f.id, n2.id, n3.id]);

    const first = await callNext(d.token);
    expect(first.status).toBe(200);
    expect(first.data.id).toBe(n1.id);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("CONFIRMED");

    await db.appointment.update({ where: { id: n1.id }, data: { status: "COMPLETED", endedAt: new Date() } });
    expect(await order(d.token)).toEqual([f.id, n2.id, n3.id]);
    const second = await callNext(d.token);
    expect(second.status).toBe(200);
    expect(second.data.id).toBe(f.id);
  });

  it("5) لا يتجاوز مريضًا أُرسل له «دورك اقترب» (SENT)، ويُدرج في أول موضع مؤهل دون إعادة ترتيبهم", async () => {
    const d = await mkDoctor();
    await reset(d.doctorId);
    const n1 = await mkToday(d.doctorId, "ن1");
    const n2 = await mkToday(d.doctorId, "ن2");
    const n3 = await mkToday(d.doctorId, "ن3");
    const n4 = await mkToday(d.doctorId, "ن4");
    await notify(n3.id, "SENT");
    const f = await mkToday(d.doctorId, "عودة", { isFollowUp: true, arrivedAt: null });
    expect((await arrive(d.token, f.id)).status).toBe(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: f.id } })).followUpAnchorId).toBe(n3.id);
    expect(await order(d.token)).toEqual([n1.id, n2.id, n3.id, f.id, n4.id]);
  });

  it("6) PROCESSING يحمي أيضًا، أما FAILED وSKIPPED وPENDING فلا (لم يصل تنبيه)", async () => {
    for (const [status, protectedByNotice] of [["PROCESSING", true], ["FAILED", false], ["SKIPPED", false], ["PENDING", false]] as const) {
      const d = await mkDoctor();
      await reset(d.doctorId);
      const n1 = await mkToday(d.doctorId, "ن1");
      const n2 = await mkToday(d.doctorId, "ن2");
      const n3 = await mkToday(d.doctorId, "ن3");
      await notify(n3.id, status);
      const f = await mkToday(d.doctorId, "عودة", { isFollowUp: true, arrivedAt: null });
      expect((await arrive(d.token, f.id)).status).toBe(200);
      const expected = protectedByNotice ? [n1.id, n2.id, n3.id, f.id] : [n1.id, f.id, n2.id, n3.id];
      expect(await order(d.token)).toEqual(expected);
    }
  });

  it("7) المنبَّه يبقى محميًا لو نُبِّه بعد حضور موعد العودة (الحماية ديناميكية للمنبَّهين)", async () => {
    const d = await mkDoctor();
    await reset(d.doctorId);
    const n1 = await mkToday(d.doctorId, "ن1");
    const n2 = await mkToday(d.doctorId, "ن2");
    const n3 = await mkToday(d.doctorId, "ن3");
    const f = await mkToday(d.doctorId, "عودة", { isFollowUp: true, arrivedAt: null });
    await arrive(d.token, f.id);
    expect(await order(d.token)).toEqual([n1.id, f.id, n2.id, n3.id]);
    await notify(n3.id, "SENT");
    expect(await order(d.token)).toEqual([n1.id, n2.id, n3.id, f.id]);
  });

  it("8) موعد عودة LATE (سبق تأجيله) لا يحصل على أولوية — العقوبة باقية", async () => {
    const d = await mkDoctor();
    await reset(d.doctorId);
    const n1 = await mkToday(d.doctorId, "ن1");
    const n2 = await mkToday(d.doctorId, "ن2");
    const f = await mkToday(d.doctorId, "عودة", { isFollowUp: true, arrivedAt: null });
    await arrive(d.token, f.id);
    const late = await call("POST", `/api/appointments/${f.id}/late`, d.token);
    expect(late.status).toBe(200);
    await arrive(d.token, f.id);
    const row = await db.appointment.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.status).toBe("LATE");
    expect(row.deferredCount).toBeGreaterThan(0);
    const ord = await order(d.token);
    expect(ord.indexOf(f.id)).toBeGreaterThan(ord.indexOf(n1.id));
    expect(ord.indexOf(f.id)).toBeGreaterThan(ord.indexOf(n2.id));
  });

  it("9) موعد عودة لم يحضر لا يتقدم ولا يؤثر في الآخرين", async () => {
    const d = await mkDoctor();
    await reset(d.doctorId);
    const n1 = await mkToday(d.doctorId, "ن1");
    const n2 = await mkToday(d.doctorId, "ن2");
    const f = await mkToday(d.doctorId, "عودة", { isFollowUp: true, arrivedAt: null });
    expect(await order(d.token)).toEqual([n1.id, n2.id, f.id]);
  });

  it("10) الطوارئ المعتمدة تبقى أمام موعد العودة", async () => {
    const d = await mkDoctor();
    await reset(d.doctorId);
    const n1 = await mkToday(d.doctorId, "ن1");
    const u = await mkToday(d.doctorId, "طوارئ", { urgencyStatus: "APPROVED" });
    const f = await mkToday(d.doctorId, "عودة", { isFollowUp: true, arrivedAt: null });
    await arrive(d.token, f.id);
    const ord = await order(d.token);
    expect(ord[0]).toBe(u.id);
    expect(ord.indexOf(u.id)).toBeLessThan(ord.indexOf(f.id));
    // المحمي هو التالي مباشرة (وهو الطوارئ هنا)، فيتقدم موعد العودة على n1 الذي هو الثاني فقط.
    expect(ord).toEqual([u.id, f.id, n1.id]);
  });

  it("11) صفحة «حالة دوري» وتقدير الدور يتبعان الترتيب نفسه (من يسبق المريض يزيد بموعد العودة)", async () => {
    const d = await mkDoctor();
    await reset(d.doctorId);
    const n1 = await mkToday(d.doctorId, "ن1");
    const n2 = await mkToday(d.doctorId, "ن2");
    const f = await mkToday(d.doctorId, "عودة", { isFollowUp: true, arrivedAt: null });
    const { getAppointmentQueueStatus } = await import("../../src/modules/booking/booking.service");
    // n2 يسبقه n1 فقط ⇒ 1؛ بعد حضور موعد العودة (مرساته n1) يسبق n2 موعد العودة فيصبح 2.
    expect((await getAppointmentQueueStatus(n2.id) as any).aheadOfYou).toBe(1);
    await arrive(d.token, f.id);
    expect((await getAppointmentQueueStatus(n2.id) as any).aheadOfYou).toBe(2);
  });

  // ---------------- الصلاحيات ----------------
  it("12) المساعد لا ينشئ موعد عودة (403)، والطبيب ينشئه حتى مع وجود مساعد، والحجز العادي للطبيب يبقى ممنوعًا", async () => {
    const d = await mkDoctor(true);
    const parent = await mkToday(d.doctorId, "أصل", { status: "COMPLETED" });
    const body = () => ({ date: dayStr(4), startTime: "09:00", idempotencyKey: randomUUID() });
    const asAssistant = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, d.assistantToken, body());
    expect(asAssistant.status).toBe(403);
    const asDoctor = await call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, d.token, body());
    expect(asDoctor.status).toBe(201);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: asDoctor.data.id } })).isFollowUp).toBe(true);
    const guest = await call("POST", "/api/doctor/appointments/guest", d.token, { firstName: "زائر", lastName: tag, phone: "0551234567", date: dayStr(4), startTime: "11:00", idempotencyKey: randomUUID() });
    expect(guest.status).toBe(403);
  });

  // ---------------- التزامن ----------------
  it("13) حجوزات المرضى وجدولة العودة معًا لنفس الوقت ⇒ الكل ينجح بأوقات مختلفة بلا تكرار ولا 5xx", async () => {
    const d = await mkDoctor();
    const parent = await mkToday(d.doctorId, "أصل", { status: "COMPLETED" });
    const date = dayStr(5);
    const patientTokens: string[] = [];
    for (let i = 0; i < 6; i++) {
      const n = ++seq;
      const reg = await call("POST", "/api/patient/auth/register", undefined, {
        email: `${tag}-p${n}@test.local`, password: "Secret123!", name: `مريض ${n}`, phone: `07${String(Date.now() + n).slice(-8)}`,
      });
      expect(reg.status).toBe(201);
      ids.users.push(reg.data.user.id);
      patientTokens.push(reg.data.accessToken);
    }
    const jobs = [
      ...patientTokens.map((t) => call("POST", "/api/appointments", t, { doctorId: d.doctorId, date, startTime: "10:00" })),
      ...Array.from({ length: 4 }, () => call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, d.token, { date, startTime: "10:00", idempotencyKey: randomUUID() })),
    ];
    const results = await Promise.all(jobs);
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
    expect(results.map((r) => r.status).every((s) => s === 201)).toBe(true);
    const rows = await db.appointment.findMany({ where: { doctorId: d.doctorId, date: new Date(`${date}T00:00:00Z`), status: { not: "CANCELLED" } } });
    expect(rows.length).toBe(10);
    expect(new Set(rows.map((r) => r.startTime)).size).toBe(10);
    expect(rows.every((r) => HHMM.test(r.startTime))).toBe(true);
    expect(rows.filter((r) => r.isFollowUp).length).toBe(4);
  }, 60000);

  it("14) إعادة إرسال نفس طلب موعد العودة (نفس المفتاح) لا ينشئ موعدين", async () => {
    const d = await mkDoctor();
    const parent = await mkToday(d.doctorId, "أصل", { status: "COMPLETED" });
    const key = randomUUID();
    const [a, b] = await Promise.all([1, 2].map(() => call("POST", `/api/doctor/appointments/${parent.id}/follow-up`, d.token, { date: dayStr(6), startTime: "09:00", idempotencyKey: key })));
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
    expect(a.data.id).toBe(b.data.id);
    expect(await db.appointment.count({ where: { doctorId: d.doctorId, isFollowUp: true } })).toBe(1);
  });
});
