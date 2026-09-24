/**
 * توفر المواعيد حسب الحالة الفعلية للطابور — على PostgreSQL حقيقي عبر HTTP:
 * GET /api/doctors/:id/availability و POST /api/booking (بتاريخ ووقت) تحت قفل الطبيب والقيد الفريد.
 * الساعة مثبّتة (Date فقط) على الاثنين 2026-10-05 الساعة 15:20 بتوقيت الجزائر.
 * تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run liveAvailability
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}

const DAY = "2026-10-05"; // الاثنين
const DAY_DATE = new Date(DAY + "T00:00:00Z");
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 5, h - 1, m, 0));
};
const DUR = 20;
const add = (hhmm: string, min: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

describe.skipIf(!TEST_URL)("توفر اليوم حسب الطابور الفعلي (PostgreSQL حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  const tag = `live${Date.now().toString(36)}`;
  const ids = { wilaya: "", city: "", specialty: "", users: [] as string[], doctors: [] as string[] };
  const patients: { userId: string; token: string }[] = [];

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined };
  };
  const availability = (doctorId: string) => call("GET", `/api/doctors/${doctorId}/availability?date=${DAY}`);
  const book = (doctorId: string, startTime: string | undefined, p = patients[0]) =>
    call(
      "POST",
      "/api/booking",
      { firstName: "سارة", lastName: "بن يوسف", phone: "0551234567", wilayaId: ids.wilaya, specialtyId: ids.specialty, doctorId, ...(startTime ? { date: DAY, startTime } : {}) },
      p.token
    );

  /** طبيب بدوام الاثنين 09:00–12:00 و14:00–17:00 وجلسة 20 دقيقة، وجدول اليوم ممتلئ بالكامل بالحالة المعطاة. */
  async function mkDoctorWithFullDay(label: string, status = "COMPLETED", overrides: Record<string, string> = {}) {
    const u = await db.user.create({ data: { email: `${tag}-${label}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "د", lastName: `${tag}${label}`, specialtyId: ids.specialty, wilayaId: ids.wilaya, cityId: ids.city,
        slotDurationMin: DUR, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: [{ dayOfWeek: 1, startTime: "09:00", endTime: "12:00" }, { dayOfWeek: 1, startTime: "14:00", endTime: "17:00" }] },
      },
    });
    ids.users.push(u.id);
    ids.doctors.push(d.id);
    const rows: any[] = [];
    for (const [s, e] of [["09:00", "12:00"], ["14:00", "17:00"]]) {
      for (let t = s; t < e; t = add(t, DUR)) {
        const st = overrides[t] ?? status;
        rows.push({
          doctorId: d.id, date: DAY_DATE, startTime: t, endTime: add(t, DUR), status: st,
          activeSlot: st === "CANCELLED" ? null : true, guestFirstName: "ضيف", guestLastName: "سابق", guestPhone: "0550000000",
        });
      }
    }
    await db.appointment.createMany({ data: rows });
    return d.id;
  }

  const activeOverlaps = async (doctorId: string) => {
    const act = await db.appointment.findMany({
      where: { doctorId, date: DAY_DATE, status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS", "LATE"] } },
      select: { startTime: true, endTime: true },
    });
    let n = 0;
    for (let i = 0; i < act.length; i++)
      for (let j = i + 1; j < act.length; j++)
        if (toMin(act[i].startTime) < toMin(act[j].endTime) && toMin(act[j].startTime) < toMin(act[i].endTime)) n++;
    return n;
  };

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000";
    process.env.REMINDERS_ENABLED = "false";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("15:20"));
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(ids, { wilaya: w.id, city: c.id, specialty: s.id });

    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (let i = 0; i < 10; i++) {
      const reg = await call("POST", "/api/patient/auth/register", { email: `${tag}-p${i}@test.local`, password: "Secret123!", name: `مريض ${i}` });
      expect(reg.status).toBe(201);
      patients.push({ userId: reg.data.user.id, token: reg.data.accessToken });
      ids.users.push(reg.data.user.id);
    }
  });

  afterAll(async () => {
    vi.useRealTimers();
    server?.close();
    if (!db) return;
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { appointment: { doctorId: { in: ids.doctors } } }] } });
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
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  it("1+9) كل مواعيد اليوم COMPLETED والطبيب في دوامه → وقت حي اليوم يُعرض ويُحجز فعلًا (لا دفع إلى الغد)", async () => {
    const doc = await mkDoctorWithFullDay("all-done");
    const a = await availability(doc);
    expect(a.status).toBe(200);
    expect(a.data.live).toBe(true);
    expect(a.data.slots[0]).toBe("15:21");
    expect(a.data.slots.every((s: string) => toMin(s) >= toMin("15:20"))).toBe(true);

    const r = await book(doc, a.data.slots[0]);
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ startTime: "15:21", endTime: "15:41", status: "CONFIRMED", shiftedFromRequested: false });
    expect(r.data.date.slice(0, 10)).toBe(DAY);

    // الموعد الجديد قادم (لم يحن وقته) → الطابور ما زال فارغًا الآن، والوقت التالي بعد نهايته
    const b = await availability(doc);
    expect(b.data.slots[0]).toBe("15:41");
    expect(await activeOverlaps(doc)).toBe(0);
  });

  it("2) يوجد IN_PROGRESS → لا تعتبر الطابور فارغًا: لا وقت اليوم، والحجز بوقت اليوم يُرفض 409", async () => {
    const doc = await mkDoctorWithFullDay("inprog", "COMPLETED", { "15:00": "IN_PROGRESS" });
    const a = await availability(doc);
    expect(a.data).toMatchObject({ slots: [], live: false });
    const r = await book(doc, "15:21");
    expect(r.status).toBe(409);
  });

  it("3) مواعيد مؤكدة قادمة اليوم → لا أوقات تتعارض معها، وطلب وقت متعارض يُعطى أقرب وقت صالح أو 409", async () => {
    const doc = await mkDoctorWithFullDay("future", "COMPLETED", { "16:00": "CONFIRMED", "16:40": "CONFIRMED" });
    const a = await availability(doc);
    expect(a.data.slots).toEqual(["15:21"]);
    expect((await book(doc, "15:50")).status).toBe(409); // لا وقت صالح عند/بعد 15:50 لا يتعارض
    const ok = await book(doc, "15:21");
    expect(ok.status).toBe(201);
    expect(await activeOverlaps(doc)).toBe(0);
  });

  it("4) يوجد مريض LATE → مكانه غير متاح ولا وقت حي", async () => {
    const doc = await mkDoctorWithFullDay("late", "COMPLETED", { "14:40": "LATE" });
    expect((await availability(doc)).data).toMatchObject({ slots: [], live: false });
    expect((await book(doc, "15:21")).status).toBe(409);
  });

  it("5) مواعيد CANCELLED → وقتها يُعاد استعماله كما في المنطق الحالي (حتى نفس وقت البداية)", async () => {
    const overrides: Record<string, string> = {};
    for (const t of ["15:20", "15:40", "16:00", "16:20", "16:40"]) overrides[t] = "CONFIRMED";
    overrides["16:00"] = "CANCELLED";
    const doc = await mkDoctorWithFullDay("cancel", "COMPLETED", overrides);
    // 15:20 مؤكد وحلّ وقته → الطابور غير فارغ → الشبكة وحدها: 16:00 المحرَّر
    const a = await availability(doc);
    expect(a.data).toMatchObject({ slots: ["16:00"], live: false });
    const r = await book(doc, "16:00");
    expect(r.status).toBe(201);
    expect(r.data.startTime).toBe("16:00");
  });

  it("6) NO_SHOW → ليس في الطابور؛ وقت بدايته نفسه لا يُعاد (قيد قاعدة البيانات) لكن الوقت الحي بجانبه متاح", async () => {
    const overrides: Record<string, string> = {};
    for (const t of ["15:20", "15:40", "16:00", "16:20", "16:40"]) overrides[t] = "NO_SHOW";
    const doc = await mkDoctorWithFullDay("noshow", "COMPLETED", overrides);
    const a = await availability(doc);
    expect(a.data.live).toBe(true);
    for (const t of Object.keys(overrides)) expect(a.data.slots).not.toContain(t);
    // طلب وقت بداية موعد NO_SHOW → يُعطى أقرب وقت صالح بعده (لا خطأ قاعدة بيانات)
    const r = await book(doc, "15:20");
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ startTime: "15:21", shiftedFromRequested: true });
  });

  it("7) لا حجز في الماضي: وقت مضى يُرفض، ولا تُعرض أوقات قبل الآن", async () => {
    const doc = await mkDoctorWithFullDay("past");
    const r = await book(doc, "14:00");
    expect(r.status).toBe(400);
    expect(r.message).toBe("لا يمكن الحجز في وقت مضى.");
    const a = await availability(doc);
    expect(a.data.slots.every((s: string) => toMin(s) > toMin("15:20"))).toBe(true);
  });

  it("8) بعد انتهاء ساعات عمل الطبيب → لا حجز جديد اليوم", async () => {
    const doc = await mkDoctorWithFullDay("closed");
    vi.setSystemTime(at("17:05"));
    try {
      expect((await availability(doc)).data.slots).toEqual([]);
      // توكن جديد بساعة 17:05 (صلاحية access token 15 دقيقة فقط)
      const { signAccessToken } = await import("../../src/utils/jwt");
      const fresh = { ...patients[0], token: signAccessToken({ sub: patients[0].userId, role: "PATIENT" as any }) };
      const r = await book(doc, "17:05", fresh);
      expect(r.status).toBe(400);
      expect(r.message).toBe("هذا الوقت خارج أوقات عمل الطبيب.");
    } finally {
      vi.setSystemTime(at("15:20"));
    }
  });

  it("10) عشرة مرضى يطلبون نفس الوقت الحي في نفس اللحظة → لا حجز مزدوج (كل ناجح بوقت مختلف ولا تداخل)", async () => {
    const doc = await mkDoctorWithFullDay("race");
    const results = await Promise.all(patients.map((p) => book(doc, "15:21", p)));
    const ok = results.filter((r) => r.status === 201);
    const rest = results.filter((r) => r.status !== 201);
    // الوقت الحي المتبقي حتى 17:00: 15:21, 15:41, 16:01, 16:21 → أربعة فقط، والبقية 409 (اليوم ممتلئ)
    expect(ok.map((r) => r.data.startTime).sort()).toEqual(["15:21", "15:41", "16:01", "16:21"]);
    expect(ok.filter((r) => r.data.startTime === "15:21")).toHaveLength(1);
    expect(rest.every((r) => r.status === 409)).toBe(true);
    expect(await activeOverlaps(doc)).toBe(0);
    const dup = await db.appointment.groupBy({ by: ["startTime"], where: { doctorId: doc, date: DAY_DATE, activeSlot: true }, _count: { _all: true } });
    expect(dup.every((g) => g._count._all === 1)).toBe(true);
  });

  it("بلا اختيار يوم ووقت: الحجز الآلي يبقى كما كان (أول خانة شبكة شاغرة، هنا الاثنين التالي 09:00)", async () => {
    const doc = await mkDoctorWithFullDay("auto");
    const r = await book(doc, undefined);
    expect(r.status).toBe(201);
    expect(r.data.date.slice(0, 10)).toBe("2026-10-12");
    expect(r.data.startTime).toBe("09:00");
  });

  it("POST /api/appointments (المسار الآخر للحجز بوقت) يقبل الوقت الحي نفسه", async () => {
    const doc = await mkDoctorWithFullDay("appts");
    const r = await call("POST", "/api/appointments", { doctorId: doc, date: DAY, startTime: "15:21" }, patients[1].token);
    expect(r.status).toBe(201);
    expect(r.data.startTime).toBe("15:21");
  });
});
