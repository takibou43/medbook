/**
 * تحرير أوقات المواعيد الملغاة (PostgreSQL حقيقي عبر HTTP):
 * الموعد CANCELLED يبقى محفوظًا لكنه لا يمنع حجزًا جديدًا في نفس (طبيب + تاريخ + وقت)، بينما
 * PENDING / CONFIRMED / IN_PROGRESS / LATE تمنعه، و COMPLETED / NO_SHOW على سلوكها السابق (تمنعه).
 * يغطي مسارات الإنشاء الثلاثة (POST /api/appointments، الحجز بوقت محدد، الحجز الآلي)، عرض الأوقات
 * المتاحة، مسارات الإلغاء، والتزامن. تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run slotRelease
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

describe.skipIf(!TEST_URL)("تحرير أوقات المواعيد الملغاة (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let sign: (p: { sub: string; role: any }) => string;
  const tag = `sr${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  let docA = "";
  let doctorTokenA = "";
  let docNarrow = "";
  let patientSeq = 0;
  let yearSeq = 2031;
  // مجموعة صغيرة من المرضى الحقيقيين (التسجيل له حدّ معدل صارم)؛ التعارض يُقاس على الوقت لا على المريض.
  let pool: { patientId: string; token: string }[] = [];
  let poolIdx = 0;
  const nextPatient = () => pool[poolIdx++ % pool.length];

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined };
  };
  /** تاريخ مستقبلي فريد لكل حالة اختبار (يوم إثنين دائمًا خارج أي تعارض مع حالات أخرى). */
  const freshDate = () => `${yearSeq++}-03-03`;
  const dateObj = (d: string) => new Date(d + "T00:00:00Z");
  const createAt = (token: string, date: string, startTime = "10:00", doctorId = docA) =>
    call("POST", "/api/appointments", { doctorId, date, startTime, type: "IN_PERSON" }, token);
  const slotRows = (date: string, startTime = "10:00", doctorId = docA) =>
    db.appointment.findMany({ where: { doctorId, date: dateObj(date), startTime }, orderBy: { createdAt: "asc" } });
  const availability = async (date: string, doctorId = docA) =>
    (await call("GET", `/api/doctors/${doctorId}/availability?date=${date}`)).data?.slots as string[];

  async function mkDoctor(i: string, start: string, end: string) {
    const u = await db.user.create({ data: { email: `${tag}-doc${i}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د" + i, lastName: tag, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: 20, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, dow) => ({ dayOfWeek: dow, startTime: start, endTime: end })) },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    return { userId: u.id, doctorId: d.id };
  }
  async function mkPatient() {
    const n = ++patientSeq;
    const reg = await call("POST", "/api/patient/auth/register", {
      email: `${tag}-p${n}@test.local`, password: "Secret123!", name: `مريض ${n}`, phone: `06${String(Date.now() + n).slice(-8)}`,
    });
    expect(reg.status).toBe(201);
    ids.users.push(reg.data.user.id);
    return { patientId: reg.data.user.patient.id as string, token: reg.data.accessToken as string };
  }
  /** موعد موجود مسبقًا بحالة معيّنة (ضيف قديم بلا حساب، مثل الـ65 في Production). */
  async function seedExisting(date: string, status: any, startTime = "10:00", doctorId = docA) {
    return db.appointment.create({
      data: { doctorId, date: dateObj(date), startTime, endTime: "10:20", status, guestFirstName: "ضيف", guestLastName: tag, guestPhone: "0550000000" },
    });
  }

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    process.env.REMINDERS_ENABLED = "false";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    ({ signAccessToken: sign } = await import("../../src/utils/jwt"));
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });

    const a = await mkDoctor("A", "08:00", "17:00");
    docA = a.doctorId;
    doctorTokenA = sign({ sub: a.userId, role: "DOCTOR" });
    // طبيب بخانة واحدة يوميًا (10:00-10:20): الحجز الآلي لا يملك إلا هذه الخانة في كل يوم.
    docNarrow = (await mkDoctor("N", "10:00", "10:20")).doctorId;

    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (let i = 0; i < 5; i++) pool.push(await mkPatient());
  });

  afterAll(async () => {
    server?.close();
    if (!db) return;
    await db.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
    await db.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await db.smsLog.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids.doctors } } } });
    await db.appointment.deleteMany({ where: { doctorId: { in: ids.doctors } } });
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

  it("1+8) موعد CANCELLED في 10:00 → حجز جديد في 10:00 ينجح، والملغى يبقى محفوظًا كما هو", async () => {
    const date = freshDate();
    const old = await seedExisting(date, "CANCELLED");
    expect(old.activeSlot).toBeNull(); // الـtrigger يضبطه عند الإدراج أيضًا
    expect(await availability(date)).toContain("10:00");

    const p = nextPatient();
    const r = await createAt(p.token, date);
    expect(r.status).toBe(201);

    const rows = await slotRows(date);
    expect(rows).toHaveLength(2);
    const kept = rows.find((x) => x.id === old.id)!;
    // 8) الملغى القديم لم يُحذف ولم تتغيّر أي من بياناته
    expect(kept).toEqual(old);
    const fresh = rows.find((x) => x.id !== old.id)!;
    expect(fresh).toMatchObject({ status: "PENDING", patientId: p.patientId, activeSlot: true });
  });

  for (const status of ["CONFIRMED", "PENDING", "IN_PROGRESS", "LATE"] as const) {
    it(`2-5) موعد ${status} في 10:00 → طلب 10:00 لا يأخذه (يُنقل تلقائيًا إلى 10:20) والوقت غير معروض`, async () => {
      const date = freshDate();
      await seedExisting(date, status);
      expect(await availability(date)).not.toContain("10:00");
      const r = await createAt(nextPatient().token, date);
      // منذ «أقرب موعد متاح»: لا 409، بل أول وقت شاغر بعد المطلوب — و10:00 يبقى لصاحبه وحده.
      expect(r.status).toBe(201);
      expect(r.data).toMatchObject({ startTime: "10:20", requestedStartTime: "10:00", shiftedFromRequested: true });
      expect(await slotRows(date)).toHaveLength(1);
    });
  }

  for (const status of ["COMPLETED", "NO_SHOW"] as const) {
    it(`6-7) موعد ${status}: السلوك السابق محفوظ — الوقت يبقى مشغولًا (409) ولا تغيير للسجل`, async () => {
      const date = freshDate();
      const old = await seedExisting(date, status);
      expect(old.activeSlot).toBe(true);
      const r = await createAt(nextPatient().token, date);
      // الوقت ما زال مشغولًا (السلوك السابق محفوظ): الطلب يُنقل إلى 10:20 ولا يلمس 10:00.
      expect(r.status).toBe(201);
      expect(r.data.startTime).toBe("10:20");
      expect(await slotRows(date)).toEqual([old]);
      expect(await availability(date)).not.toContain("10:00");
    });
  }

  it("9) CANCELLED + CONFIRMED في نفس الوقت → CONFIRMED يمنع أي حجز ثالث", async () => {
    const date = freshDate();
    await seedExisting(date, "CANCELLED");
    expect((await createAt(nextPatient().token, date)).status).toBe(201);
    expect(await availability(date)).not.toContain("10:00");
    const third = await createAt(nextPatient().token, date);
    expect(third.status).toBe(201);
    expect(third.data.startTime).toBe("10:20"); // لا موعد نشط ثانٍ في 10:00
    const rows = await slotRows(date);
    expect(rows.map((r) => r.status).sort()).toEqual(["CANCELLED", "PENDING"]);
    // وعلى مستوى قاعدة البيانات مباشرة (تجاوزًا لكل فحص في الكود): موعد نشط ثانٍ مرفوض
    await expect(seedExisting(date, "CONFIRMED")).rejects.toThrow();
    // بينما ملغى ثانٍ في نفس الوقت مسموح (التاريخ يُحفظ كاملًا)
    await expect(seedExisting(date, "CANCELLED")).resolves.toBeTruthy();
  });

  it("10) التزامن: 10 حجوزات متوازية لنفس الوقت الملغى → واحد فقط يأخذ 10:00 والبقية الأوقات التالية، ولا موعدين نشطين", async () => {
    const date = freshDate();
    const old = await seedExisting(date, "CANCELLED");
    const patients = Array.from({ length: 10 }, () => nextPatient());
    const res = await Promise.all(patients.map((p) => createAt(p.token, date)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(10);
    expect(res.map((r) => r.data.startTime).sort()).toEqual(["10:00", "10:20", "10:40", "11:00", "11:20", "11:40", "12:00", "12:20", "12:40", "13:00"]);
    const rows = await slotRows(date);
    expect(rows.filter((r) => r.status !== "CANCELLED")).toHaveLength(1);
    expect(rows.find((r) => r.id === old.id)).toEqual(old);
  });

  it("الإلغاء عبر التطبيق يحرّر الوقت: المريض يلغي (DELETE) → مريض آخر يحجز نفس الوقت", async () => {
    const date = freshDate();
    const p1 = nextPatient();
    const first = await createAt(p1.token, date);
    expect(first.status).toBe(201);
    const second = await createAt(nextPatient().token, date);
    expect(second.status).toBe(201);
    expect(second.data.startTime).toBe("10:20"); // 10:00 مشغول → أقرب وقت بعده
    expect((await call("DELETE", `/api/appointments/${first.data.id}`, undefined, p1.token)).status).toBe(200);
    const cancelled = await db.appointment.findUnique({ where: { id: first.data.id } });
    expect(cancelled).toMatchObject({ status: "CANCELLED", activeSlot: null, startTime: "10:00", patientId: p1.patientId });
    expect(await availability(date)).toContain("10:00");
    const again = await createAt(nextPatient().token, date);
    expect(again.status).toBe(201);
    expect(again.data.startTime).toBe("10:00"); // الوقت المحرَّر يُعاد استخدامه كما هو
  });

  it("الإلغاء من الطبيب (PATCH CANCELLED) يحرّر الوقت أيضًا", async () => {
    const date = freshDate();
    const p = nextPatient();
    const a = await createAt(p.token, date);
    expect((await call("PATCH", `/api/appointments/${a.data.id}`, { status: "CANCELLED" }, doctorTokenA)).status).toBe(200);
    expect((await db.appointment.findUnique({ where: { id: a.data.id } }))!.activeSlot).toBeNull();
    expect((await createAt(nextPatient().token, date)).status).toBe(201);
  });

  it("إلغاء حجز ضيف قديم برقم الهاتف (cancelGuestAppointment) يحرّر الوقت", async () => {
    const date = freshDate();
    const g = await seedExisting(date, "CONFIRMED");
    const { cancelGuestAppointment } = await import("../../src/modules/booking/booking.service");
    await cancelGuestAppointment(g.id, "0550000000");
    const after = await db.appointment.findUnique({ where: { id: g.id } });
    expect(after).toMatchObject({ status: "CANCELLED", activeSlot: null, startTime: "10:00", guestPhone: "0550000000" });
    expect((await createAt(nextPatient().token, date)).status).toBe(201);
  });

  it("الحجز الآلي (POST /api/booking) يعيد استخدام أول خانة كانت ملغاة بدل تخطيها", async () => {
    const p = nextPatient();
    const next1 = await call("GET", `/api/booking/next-slot?doctorId=${docNarrow}`);
    expect(next1.status).toBe(200);
    const { date, startTime } = next1.data as { date: string; startTime: string };
    // موعد ملغى يحتل تلك الخانة الوحيدة في ذلك اليوم
    await db.appointment.create({ data: { doctorId: docNarrow, date: dateObj(date), startTime, endTime: "10:20", status: "CANCELLED", guestFirstName: "ضيف" } });
    const next2 = await call("GET", `/api/booking/next-slot?doctorId=${docNarrow}`);
    expect(next2.data).toMatchObject({ date, startTime }); // لم تعد الخانة الملغاة تُتخطّى
    const booked = await call("POST", "/api/booking", { firstName: "سارة", lastName: "بن يوسف", phone: "0551234567", wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId: docNarrow }, p.token);
    expect(booked.status).toBe(201);
    const row = await db.appointment.findUnique({ where: { id: booked.data.id } });
    expect(row!.date.toISOString().slice(0, 10)).toBe(date);
    expect(row!.startTime).toBe(startTime);
    // الخانة الآن مشغولة بموعد نشط → الحجز الآلي التالي يأخذ اليوم التالي
    const next3 = await call("GET", `/api/booking/next-slot?doctorId=${docNarrow}`);
    expect(next3.data.date > date).toBe(true);
  });
});
