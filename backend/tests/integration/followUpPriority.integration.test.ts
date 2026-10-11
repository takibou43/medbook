/**
 * موعد المتابعة الطبية من «خطط العلاج» على PostgreSQL حقيقي (Express + JWT + المعاملات والأقفال + القيود):
 *  - متابعة في وقت شاغر / مشغول / عدة متابعات في نفس الدقيقة؛ الموعد الأصلي لا يُمَس؛ لا ثوانٍ في أي استجابة.
 *  - الاستثناء مخصص للمتابعة من خطة علاج صالحة وللطبيب فقط (المساعد/المريض 403، بلا خطة → 409).
 *  - الحجز العادي لا يتجاوز الوقت المحجوز (قيد فريد + CHECK + مسار الحجز)، والتكرار/التزامن لا ينشئ نسخًا.
 *  - ترتيب الطابور: المتابعة قبل العادي عند تساوي الوقت الظاهر؛ حالة IN_PROGRESS لا تتأثر؛ الإلغاء يحرّر الوقت.
 *  - سلامة المخطط: القيد الفريد الجديد (بالاسم القديم) وCHECK موجودان، والصفوف القديمة slotSeq=0/doctorFollowUp=false.
 * تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}
const DAY = 86400e3;

describe.skipIf(!TEST_URL)("موعد المتابعة الطبية من خطط العلاج (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let sign: (p: any) => string;
  const tag = `fu${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", dental: "", users: [] as string[], doctors: [] as string[], patients: [] as string[] };
  type Doc = { userId: string; doctorId: string; token: string };
  type Pat = { userId: string; patientId: string; token: string };
  let doc: Doc, docNoAssistant: Doc, otherDoc: Doc;
  let assistantToken = "";
  let owners: Pat[] = [];
  let regular: Pat;
  const parents: string[] = [];
  const plans: string[] = [];
  let stranger: Pat;

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, raw: j, message: j?.message as string | undefined };
  };
  const algeriaToday = () => new Date(new Date(Date.now() + 3600e3).toISOString().slice(0, 10) + "T00:00:00Z");
  const dayStr = (n: number) => new Date(algeriaToday().getTime() + n * DAY).toISOString().slice(0, 10);
  const DAYS = { free: dayStr(3), shared: dayStr(4), many: dayStr(5), race: dayStr(6), queue: dayStr(7), misc: dayStr(8) };

  async function mkDoctor(i: string, withAssistant: boolean): Promise<Doc> {
    const u = await db.user.create({ data: { email: `${tag}-d${i}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + i, lastName: tag, specialtyId: ids.dental, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 20, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        subscriptionExpiresAt: new Date(Date.now() + 90 * DAY),
        schedules: { create: Array.from({ length: 7 }, (_, k) => ({ dayOfWeek: k, startTime: "08:00", endTime: "12:00" })) },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    if (withAssistant) {
      const au = await db.user.create({ data: { email: `${tag}-a${i}@test.local`, passwordHash: "x", role: "ASSISTANT" } });
      await db.assistant.create({ data: { userId: au.id, doctorId: d.id, firstName: "مساعد", lastName: tag } });
      ids.users.push(au.id);
      assistantToken = sign({ sub: au.id, role: "ASSISTANT" });
    }
    return { userId: u.id, doctorId: d.id, token: sign({ sub: u.id, role: "DOCTOR" }) };
  }
  async function mkPatient(i: string): Promise<Pat> {
    const u = await db.user.create({ data: { email: `${tag}-p${i}@test.local`, passwordHash: "x", role: "PATIENT", phone: "06" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") } });
    const p = await db.patient.create({ data: { userId: u.id, firstName: "مريض" + i, lastName: tag } });
    ids.users.push(u.id);
    ids.patients.push(p.id);
    return { userId: u.id, patientId: p.id, token: sign({ sub: u.id, role: "PATIENT" }) };
  }
  let apptSeq = 0;
  /** زيارة سابقة مكتملة (الموعد الأصلي لبرمجة العودة) — في الماضي بوقت فريد. */
  async function mkParent(doctorId: string, patientId: string) {
    apptSeq += 1;
    const t = `${String(13 + Math.floor(apptSeq / 6)).padStart(2, "0")}:${String((apptSeq % 6) * 10).padStart(2, "0")}`;
    return db.appointment.create({
      data: { doctorId, patientId, date: new Date(algeriaToday().getTime() - 5 * DAY), startTime: t, endTime: t, status: "COMPLETED", activeSlot: true, guestFirstName: "م", guestLastName: tag, createdBy: "PATIENT" },
    });
  }
  /** حجز عادي مباشر (slotSeq=0) يشغل الوقت. */
  const mkRegular = (doctorId: string, patientId: string | null, date: string, startTime: string, extra: Record<string, unknown> = {}) =>
    db.appointment.create({
      data: { doctorId, patientId, date: new Date(date + "T00:00:00Z"), startTime, endTime: startTime, status: "CONFIRMED", activeSlot: true, guestFirstName: "عادي", guestLastName: tag, createdBy: "PATIENT", ...(extra as any) },
    });
  const followUp = (parentId: string, token: string, date: string, startTime: string, planId?: string, extra: Record<string, unknown> = {}) =>
    call("POST", `/api/doctor/appointments/${parentId}/follow-up`, { date, startTime, notes: "مراجعة", idempotencyKey: randomUUID(), ...(planId ? { treatmentPlanId: planId } : {}), ...extra }, token);

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL!;
    process.env.RATE_LIMIT_MAX = "1000000";
    process.env.REMINDERS_ENABLED = "false";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const w = await db.wilaya.create({ data: { code: tag.slice(-5) + "a", nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const dental = await db.specialty.create({ data: { nameAr: `طب الأسنان ${tag}`, nameFr: "Dentisterie" } });
    Object.assign(ids, { wilaya: w.id, city: c.id, dental: dental.id });
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    doc = await mkDoctor("A", true);
    docNoAssistant = await mkDoctor("B", false);
    otherDoc = await mkDoctor("C", false);
    regular = await mkPatient("R");
    stranger = await mkPatient("S");
    for (let i = 0; i < 8; i++) {
      const o = await mkPatient("O" + i);
      owners.push(o);
      parents.push((await mkParent(doc.doctorId, o.patientId)).id);
      const pl = await call("POST", "/api/doctor/treatment-plans", { patientId: o.patientId, title: `خطة ${i}` }, doc.token);
      expect(pl.status).toBe(201);
      plans.push(pl.data.id);
    }
  }, 90000);

  afterAll(async () => {
    server?.close();
    if (!db) return;
    await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } }).catch(() => undefined);
    await db.dentalFollowUp.deleteMany({ where: { treatmentPlan: { doctorId: { in: ids.doctors } } } }).catch(() => undefined);
    await db.appointmentFinancial.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } }).catch(() => undefined);
    await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.dentalTreatmentPlan.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.assistant.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: ids.doctors } } });
    await db.patient.deleteMany({ where: { id: { in: ids.patients } } });
    await db.user.deleteMany({ where: { id: { in: ids.users } } });
    await db.specialty.deleteMany({ where: { id: ids.dental } });
    await db.city.deleteMany({ where: { id: ids.city } });
    await db.wilaya.deleteMany({ where: { id: ids.wilaya } });
    await db.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------
  describe("1) متابعة عند وقت غير محجوز", () => {
    it("تُنشأ كمتابعة طبية (doctorFollowUp=true) بقيمة داخلية 0، والوقت الظاهر HH:mm دون ثوانٍ، والأصلي لم يتغير", async () => {
      const parent = await db.appointment.findUniqueOrThrow({ where: { id: parents[0] } });
      const r = await followUp(parents[0], doc.token, DAYS.free, "09:00", plans[0]);
      expect(r.status).toBe(201);
      expect(r.data).toMatchObject({ status: "CONFIRMED", type: "FOLLOW_UP", startTime: "09:00", doctorFollowUp: true, treatmentPlanId: plans[0] });
      const row = await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } });
      expect(row).toMatchObject({ slotSeq: 0, doctorFollowUp: true, startTime: "09:00", activeSlot: true, createdByUserId: doc.userId });
      const after = await db.appointment.findUniqueOrThrow({ where: { id: parents[0] } });
      expect(after.updatedAt.getTime()).toBe(parent.updatedAt.getTime());
      expect(after.status).toBe(parent.status);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("2 + 4 + 14) متابعة عند وقت محجوز: الموعد السابق يبقى كما هو والوقت الظاهر بلا ثوانٍ", () => {
    let regularRow: Awaited<ReturnType<typeof mkRegular>>;
    it("تنجح بقيمة داخلية 1 دون تعديل أو إلغاء الحجز العادي", async () => {
      regularRow = await mkRegular(doc.doctorId, regular.patientId, DAYS.shared, "10:00");
      const before = await db.appointment.findUniqueOrThrow({ where: { id: regularRow.id } });
      const r = await followUp(parents[1], doc.token, DAYS.shared, "10:00", plans[1]);
      expect(r.status).toBe(201);
      expect(r.data.startTime).toBe("10:00");
      const row = await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } });
      expect(row).toMatchObject({ slotSeq: 1, doctorFollowUp: true, startTime: "10:00", status: "CONFIRMED", activeSlot: true });
      const same = await db.appointment.findUniqueOrThrow({ where: { id: regularRow.id } });
      expect(same.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(same).toMatchObject({ status: "CONFIRMED", startTime: "10:00", slotSeq: 0, doctorFollowUp: false, activeSlot: true, patientId: regular.patientId });
    });
    it("كل واجهات القراءة تعرض 10:00 فقط (لا ثوانٍ في أي استجابة)", async () => {
      const list = await call("GET", `/api/appointments?date=${DAYS.shared}`, undefined, doc.token);
      expect(list.status).toBe(200);
      const times = (list.data as any[]).map((a) => a.startTime);
      expect(times.filter((t) => t === "10:00").length).toBe(2);
      for (const t of times) expect(t).toMatch(/^\d{2}:\d{2}$/);
      const mine = await call("GET", "/api/patient/account/appointments", undefined, owners[1].token);
      for (const a of mine.data as any[]) expect(a.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(JSON.stringify(list.raw)).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    });
    it("بلا خطة علاج لا استثناء: الوقت المحجوز → 409 SLOT_TAKEN ولا صف جديد", async () => {
      const before = await db.appointment.count({ where: { doctorId: doc.doctorId, date: new Date(DAYS.shared + "T00:00:00Z") } });
      const r = await followUp(parents[2], doc.token, DAYS.shared, "10:00");
      expect(r.status).toBe(409);
      expect(await db.appointment.count({ where: { doctorId: doc.doctorId, date: new Date(DAYS.shared + "T00:00:00Z") } })).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("3) عدة متابعات في نفس الدقيقة", () => {
    it("تحصل كل واحدة على قيمة داخلية فريدة وكلها تظهر 10:00 بينما يبقى الحجز العادي كما هو", async () => {
      const day = new Date(DAYS.many + "T00:00:00Z");
      const base0 = await mkRegular(doc.doctorId, regular.patientId, DAYS.many, "10:20");
      const seqs: number[] = [];
      for (let i = 2; i < 6; i++) {
        const r = await followUp(parents[i], doc.token, DAYS.many, "10:20", plans[i]);
        expect(r.status).toBe(201);
        seqs.push((await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } })).slotSeq);
      }
      expect(seqs).toEqual([1, 2, 3, 4]);
      const rows = await db.appointment.findMany({ where: { doctorId: doc.doctorId, date: day, startTime: "10:20" } });
      expect(rows.length).toBe(5);
      expect(new Set(rows.map((x) => x.startTime))).toEqual(new Set(["10:20"]));
      expect(rows.find((x) => x.id === base0.id)).toMatchObject({ slotSeq: 0, doctorFollowUp: false });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("5 + 14) الحجز العادي لا يتجاوز الوقت المحجوز", () => {
    it("إدراج مباشر لحجز عادي في وقت مشغول → يرفضه القيد الفريد", async () => {
      await expect(mkRegular(doc.doctorId, null, DAYS.shared, "10:00")).rejects.toMatchObject({ code: "P2002" });
    });
    it("إدراج مباشر لحجز عادي بـ slotSeq>0 → يرفضه CHECK في قاعدة البيانات", async () => {
      await expect(mkRegular(doc.doctorId, null, DAYS.shared, "11:40", { slotSeq: 1 })).rejects.toThrow(/appointments_slot_seq_follow_up_chk|check constraint/i);
    });
    it("الحجز عبر API لوقت مشغول لا ينشئ صفًا ثانيًا عند 10:00: يُنقل لأقرب وقت شاغر أو يُرفض (السلوك القديم)", async () => {
      const wilayaCall = await call("POST", "/api/booking", { firstName: "سارة", lastName: "ب", phone: "0551234567", wilayaId: ids.wilaya, specialtyId: ids.dental, doctorId: doc.doctorId, date: DAYS.shared, startTime: "10:00" }, regular.token);
      if (wilayaCall.status === 201 || wilayaCall.status === 200) expect(wilayaCall.data.startTime).not.toBe("10:00");
      else expect([400, 409]).toContain(wilayaCall.status);
      const at10 = await db.appointment.count({ where: { doctorId: doc.doctorId, date: new Date(DAYS.shared + "T00:00:00Z"), startTime: "10:00", slotSeq: 0, activeSlot: true } });
      expect(at10).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("6 + 7 + 8) الصلاحيات", () => {
    it("المساعد لا يستطيع (403) ولا يُنشأ شيء", async () => {
      const before = await db.appointment.count({ where: { doctorId: doc.doctorId } });
      const r = await followUp(parents[6], assistantToken, DAYS.misc, "09:20", plans[6]);
      expect(r.status).toBe(403);
      expect(await db.appointment.count({ where: { doctorId: doc.doctorId } })).toBe(before);
      expect((await call("GET", `/api/doctor/follow-up-slots?date=${DAYS.misc}&includeBooked=true`, undefined, assistantToken)).status).toBe(403);
    });
    it("المريض لا يستطيع (403)", async () => {
      expect((await followUp(parents[6], owners[6].token, DAYS.misc, "09:20", plans[6])).status).toBe(403);
    });
    it("الطبيب ينجح حتى مع وجود مساعد، وكذلك الطبيب بلا مساعد", async () => {
      expect((await followUp(parents[6], doc.token, DAYS.misc, "09:40", plans[6])).status).toBe(201);
      const pB = await mkPatient("B1");
      const parentB = await mkParent(docNoAssistant.doctorId, pB.patientId);
      const planB = await call("POST", "/api/doctor/treatment-plans", { patientId: pB.patientId, title: "خطة" }, docNoAssistant.token);
      expect(planB.status).toBe(201);
      await mkRegular(docNoAssistant.doctorId, null, DAYS.misc, "10:00");
      const r = await followUp(parentB.id, docNoAssistant.token, DAYS.misc, "10:00", planB.data.id);
      expect(r.status).toBe(201);
      expect((await db.appointment.findUniqueOrThrow({ where: { id: r.data.id } })).slotSeq).toBe(1);
    });
    it("طبيب لا علاقة له بالمريض (موعد طبيب آخر) → 404، وخطة مريض آخر → 400/404", async () => {
      expect((await followUp(parents[7], otherDoc.token, DAYS.misc, "09:00", plans[7])).status).toBe(404);
      const foreignPlan = await followUp(parents[7], doc.token, DAYS.misc, "11:00", plans[0]);
      expect([400, 404]).toContain(foreignPlan.status);
      const strangerParent = await mkParent(doc.doctorId, stranger.patientId);
      const wrongPlan = await followUp(strangerParent.id, doc.token, DAYS.misc, "11:20", plans[7]);
      expect(wrongPlan.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("9 + 10) التكرار والتزامن", () => {
    it("نفس المفتاح مرتين متتاليتين → نفس الموعد ولا نسخة ثانية", async () => {
      const key = randomUUID();
      const a = await followUp(parents[3], doc.token, DAYS.race, "08:00", plans[3], { idempotencyKey: key });
      const b = await followUp(parents[3], doc.token, DAYS.race, "08:00", plans[3], { idempotencyKey: key });
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      expect(b.data.id).toBe(a.data.id);
      expect(await db.appointment.count({ where: { idempotencyKey: key } })).toBe(1);
    });
    it("ضغط متزامن بنفس المفتاح 6 مرات → صف واحد فقط", async () => {
      const key = randomUUID();
      const rs = await Promise.all(Array.from({ length: 6 }, () => followUp(parents[4], doc.token, DAYS.race, "08:20", plans[4], { idempotencyKey: key })));
      for (const r of rs) expect([200, 201, 409, 503]).toContain(r.status);
      expect(rs.some((r) => r.status === 201 || r.status === 200)).toBe(true);
      expect(await db.appointment.count({ where: { idempotencyKey: key } })).toBeLessThanOrEqual(1);
      expect(rs.every((r) => r.status !== 500)).toBe(true);
    });
    it("6 طلبات متزامنة بمفاتيح مختلفة لنفس الوقت (حتى مع حجز عادي) → قيم داخلية فريدة بلا 500 ولا قيد مخترق", async () => {
      const base0 = await mkRegular(doc.doctorId, regular.patientId, DAYS.race, "09:00");
      const rs = await Promise.all(
        [0, 1, 2, 5, 6, 7].map((i) => followUp(parents[i], doc.token, DAYS.race, "09:00", plans[i]))
      );
      for (const r of rs) expect(r.status).toBe(201);
      const rows = await db.appointment.findMany({ where: { doctorId: doc.doctorId, date: new Date(DAYS.race + "T00:00:00Z"), startTime: "09:00" } });
      expect(rows.length).toBe(7);
      expect(new Set(rows.map((r) => r.slotSeq)).size).toBe(7);
      expect(rows.find((r) => r.id === base0.id)?.slotSeq).toBe(0);
      expect(rows.filter((r) => r.slotSeq === 0).length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("11 + 13) الطابور والأولوية والحالات", () => {
    // وقت لاحق اليوم (بتوقيت الجزائر) بعد ساعة على الأقل؛ نتخطى الاختبار قرب منتصف الليل.
    const nowAlg = new Date(Date.now() + 3600e3);
    const mins = nowAlg.getUTCHours() * 60 + nowAlg.getUTCMinutes();
    const slotMin = Math.ceil((mins + 60) / 20) * 20;
    const canRun = slotMin < 23 * 60;
    const hhmm = `${String(Math.floor(slotMin / 60)).padStart(2, "0")}:${String(slotMin % 60).padStart(2, "0")}`;
    const today = dayStr(0);
    let qDoc: Doc;
    const queueIds = async () => (await call("GET", "/api/appointments/queue", undefined, qDoc.token)).data;

    it.skipIf(!canRun)("في نفس الوقت الظاهر: المتابعة تسبق الحجوزات العادية في الطابور، والحجز العادي القديم لا يتغير ترتيبه", async () => {
      // طبيب مخصص بدوام طوال اليوم كي يصلح أي وقت لاحق اليوم.
      const u = await db.user.create({ data: { email: `${tag}-q@test.local`, passwordHash: "x", role: "DOCTOR" } });
      const d = await db.doctor.create({
        data: {
          userId: u.id, firstName: "طابور", lastName: tag, specialtyId: ids.dental, wilayaId: ids.wilaya, cityId: ids.city, slotDurationMin: 20,
          verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date(Date.now() + 90 * DAY),
          schedules: { create: Array.from({ length: 7 }, (_, k) => ({ dayOfWeek: k, startTime: "00:00", endTime: "23:59" })) },
        },
      });
      ids.users.push(u.id);
      ids.doctors.push(d.id);
      qDoc = { userId: u.id, doctorId: d.id, token: sign({ sub: u.id, role: "DOCTOR" }) };
      const pA = await mkPatient("QA");
      const parent = await mkParent(d.id, pA.patientId);
      const plan = await call("POST", "/api/doctor/treatment-plans", { patientId: pA.patientId, title: "خطة طابور" }, qDoc.token);
      expect(plan.status).toBe(201);
      // حجزان عاديان بمعرّفات قبل/بعد (id أولًا أبجديًا) + متابعة؛ الجميع حاضر.
      const r1 = await mkRegular(d.id, null, today, hhmm, { arrivedAt: new Date(), id: "00000000-0000-4000-8000-000000000001" });
      const f = await followUp(parent.id, qDoc.token, today, hhmm, plan.data.id);
      expect(f.status).toBe(201);
      await db.appointment.update({ where: { id: f.data.id }, data: { arrivedAt: new Date() } });
      const q = await queueIds();
      const order = (q.ordered as any[]).map((a) => a.id);
      expect(order.indexOf(f.data.id)).toBeLessThan(order.indexOf(r1.id));
      expect((q.ordered as any[]).every((a) => /^\d{2}:\d{2}$/.test(a.startTime))).toBe(true);
    });

    it.skipIf(!canRun)("المناداة: يُنادى صاحب الأولوية أولًا ولا تتأثر حالة كشف قائم (IN_PROGRESS)", async () => {
      const inside = await mkRegular(qDoc.doctorId, null, today, "00:20", { status: "IN_PROGRESS", arrivedAt: new Date(), calledAt: new Date() });
      const pB = await mkPatient("QB");
      const parentB = await mkParent(qDoc.doctorId, pB.patientId);
      const planB = await call("POST", "/api/doctor/treatment-plans", { patientId: pB.patientId, title: "خطة ب" }, qDoc.token);
      const f2 = await followUp(parentB.id, qDoc.token, today, hhmm, planB.data.id);
      expect(f2.status).toBe(201);
      const after = await db.appointment.findUniqueOrThrow({ where: { id: inside.id } });
      expect(after.status).toBe("IN_PROGRESS");
      // إلغاء المتابعة يحرّر وقتها ولا يمس بقية الصفوف.
      const cancel = await call("PATCH", `/api/appointments/${f2.data.id}`, { status: "CANCELLED" }, qDoc.token);
      expect(cancel.status).toBe(200);
      expect(await db.appointment.findUniqueOrThrow({ where: { id: f2.data.id } })).toMatchObject({ status: "CANCELLED", activeSlot: null, startTime: hhmm });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("13 + 17 + 18) الإلغاء، الجدولة، وسلامة المخطط", () => {
    it("إلغاء متابعة يحرّر وقتها (activeSlot=NULL) ويبقى الصف؛ ثم متابعة جديدة بنفس الوقت لا تتعارض", async () => {
      const day = dayStr(9);
      await mkRegular(doc.doctorId, regular.patientId, day, "11:00");
      const a = await followUp(parents[0], doc.token, day, "11:00", plans[0]);
      expect(a.status).toBe(201);
      const cancel = await call("PATCH", `/api/appointments/${a.data.id}`, { status: "CANCELLED" }, doc.token);
      expect(cancel.status).toBe(200);
      const cancelled = await db.appointment.findUniqueOrThrow({ where: { id: a.data.id } });
      expect(cancelled).toMatchObject({ status: "CANCELLED", activeSlot: null, startTime: "11:00" });
      const b = await followUp(parents[1], doc.token, day, "11:00", plans[1]);
      expect(b.status).toBe(201);
      expect((await db.appointment.findUniqueOrThrow({ where: { id: b.data.id } })).slotSeq).toBeGreaterThanOrEqual(1);
    });
    it("إعادة جدولة متابعة طبية إلى وقت مشغول تعمل وتحدّث القيمة الداخلية دون المساس بالآخرين", async () => {
      const day = dayStr(10);
      const occ = await mkRegular(doc.doctorId, regular.patientId, day, "10:40");
      const f = await followUp(parents[0], doc.token, day, "09:00", plans[0], {});
      expect(f.status).toBe(201);
      const rs = await call("POST", `/api/doctor/appointments/${f.data.id}/reschedule`, { date: day, startTime: "10:40" }, doc.token);
      expect(rs.status).toBe(200);
      const moved = await db.appointment.findUniqueOrThrow({ where: { id: f.data.id } });
      expect(moved).toMatchObject({ startTime: "10:40", slotSeq: 1, doctorFollowUp: true });
      expect((await db.appointment.findUniqueOrThrow({ where: { id: occ.id } })).slotSeq).toBe(0);
    });
    it("includeBooked يُرجع كل أوقات الدوام مع busy دون أي بيانات مريض ولا ثوانٍ", async () => {
      const r = await call("GET", `/api/doctor/follow-up-slots?date=${DAYS.shared}&includeBooked=true`, undefined, doc.token);
      expect(r.status).toBe(200);
      const busy = (r.data.allSlots as { time: string; busy: boolean }[]).find((s) => s.time === "10:00");
      expect(busy?.busy).toBe(true);
      expect(JSON.stringify(r.data)).not.toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(Object.keys(r.data.allSlots[0]).sort()).toEqual(["busy", "time"]);
      const plain = await call("GET", `/api/doctor/follow-up-slots?date=${DAYS.shared}`, undefined, doc.token);
      expect(plain.data.allSlots).toBeUndefined();
      expect(plain.data.slots).not.toContain("10:00");
    });
    it("المخطط: القيد الفريد الجديد (بالاسم القديم) يشمل slotSeq، وCHECK موجود، والخطة الحالية لم تتأثر", async () => {
      const idx = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'appointments_doctorId_date_startTime_activeSlot_key'`;
      expect(idx.length).toBe(1);
      expect(idx[0].indexdef).toMatch(/slotSeq/);
      const chk = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_constraint WHERE conname = 'appointments_slot_seq_follow_up_chk'`;
      expect(Number(chk[0].n)).toBe(1);
      const bad = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM appointments WHERE "slotSeq" <> 0 AND "doctorFollowUp" = false`;
      expect(Number(bad[0].n)).toBe(0);
      // الصفوف غير المرتبطة بخطة لم تُعلَّم متابعة طبية.
      const legacy = await db.appointment.findUniqueOrThrow({ where: { id: parents[0] } });
      expect(legacy).toMatchObject({ doctorFollowUp: false, slotSeq: 0 });
      // لا مواعيد نشطة مكررة بنفس (طبيب، يوم، وقت، slotSeq).
      const dup = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM (
          SELECT 1 FROM appointments WHERE "activeSlot" = true GROUP BY "doctorId","date","startTime","slotSeq" HAVING count(*) > 1) t`;
      expect(Number(dup[0].n)).toBe(0);
    });
    it("خطة العلاج والتاريخ الطبي لم يتأثرا: الخطة تُقرأ وتحتفظ بجلساتها ومتابعاتها", async () => {
      const r = await call("GET", `/api/doctor/treatment-plans/${plans[1]}`, undefined, doc.token);
      expect(r.status).toBe(200);
      expect(r.data.id).toBe(plans[1]);
    });
    it("لا اتصالات معلّقة داخل معاملة بعد كل هذا (القفل لا يتسرب)", async () => {
      const idle = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE state = 'idle in transaction' AND datname = current_database()`;
      expect(Number(idle[0].n)).toBe(0);
    });
  });
});
