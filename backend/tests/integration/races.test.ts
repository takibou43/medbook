/**
 * سباقات متزامنة على قاعدة بيانات اختبار حقيقية (تُرفض أي قاعدة غير محلية أو بلا "test" في اسمها):
 *  1) 50 طلب حجز لنفس الطبيب والتاريخ والوقت → حجز واحد بالضبط والباقي 409.
 *  2) 40 نداء "التالي" متزامنًا → مريض واحد فقط IN_PROGRESS.
 *  3) 30 طلب "لم يحضر" متزامنًا لنفس الموعد → فائز واحد، وسجل SMS واحد، ولا 500.
 *  4) 150 حجز تلقائي لطبيب واحد بمجمّع اتصالات صغير → لا 500 ولا فقدان ولا تكرار.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:54329/medbook_test?schema=public" npm test -- races
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;

function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  const dbName = u.pathname.replace(/^\//, "");
  if (!okHost || !/test/i.test(dbName)) throw new Error(`رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي "test".`);
}

describe.skipIf(!TEST_URL)("Races (تزامن حقيقي)", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let signAccessToken: (p: { sub: string; role: any }) => string;
  let today: Date;
  let patientToken = ""; // الحجز يتطلب حساب مريض مسجّل الدخول
  const tag = `race${Date.now().toString(36)}`;
  const created = { userIds: [] as string[], doctorIds: [] as string[], wilayaId: "", cityId: "", specialtyId: "" };

  async function mkDoctor(i: string) {
    const user = await db.user.create({ data: { email: `${tag}-${i}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const doctor = await db.doctor.create({
      data: {
        userId: user.id, firstName: "د" + i, lastName: tag, specialtyId: created.specialtyId, wilayaId: created.wilayaId,
        cityId: created.cityId, slotDurationMin: 20, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startTime: "08:00", endTime: "18:00" })) },
      },
    });
    created.userIds.push(user.id);
    created.doctorIds.push(doctor.id);
    return { id: doctor.id, userId: user.id, token: signAccessToken({ sub: user.id, role: "DOCTOR" }) };
  }

  const call = async (method: string, url: string, body?: unknown, token?: string, i = 0) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(i % 250) + 1}`, ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message };
  };

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    const sep = TEST_URL!.includes("?") ? "&" : "?";
    process.env.DATABASE_URL = TEST_URL + sep + "connection_limit=5"; // مجمّع صغير يحاكي بيئة محدودة
    process.env.RATE_LIMIT_MAX = "1000000";
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const wilaya = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const city = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: wilaya.id } });
    const specialty = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(created, { wilayaId: wilaya.id, cityId: city.id, specialtyId: specialty.id });
    ({ signAccessToken } = await import("../../src/utils/jwt"));
    const slots = await import("../../src/lib/slots");
    today = slots.algeriaTodayUTCMidnight();
    const pu = await db.user.create({ data: { email: `${tag}-patient@test.local`, passwordHash: "x", role: "PATIENT", patient: { create: { firstName: "مريض", lastName: tag } } } });
    created.userIds.push(pu.id);
    patientToken = signAccessToken({ sub: pu.id, role: "PATIENT" });
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (db) {
      const ids = created.doctorIds;
      await db.smsLog.deleteMany({ where: { appointment: { doctorId: { in: ids } } } });
      await db.notification.deleteMany({ where: { userId: { in: created.userIds } } });
      await db.appointment.deleteMany({ where: { doctorId: { in: ids } } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids } } });
      await db.doctor.deleteMany({ where: { id: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: created.userIds } } });
      await db.specialty.deleteMany({ where: { id: created.specialtyId } });
      await db.city.deleteMany({ where: { id: created.cityId } });
      await db.wilaya.deleteMany({ where: { id: created.wilayaId } });
      await db.$disconnect();
    }
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  it("50 طلب لنفس الطبيب/التاريخ/الوقت → حجز واحد والباقي 409", async () => {
    const d = await mkDoctor("slot");
    const date = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10);
    const rs = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        call("POST", "/api/booking", {
          firstName: "مريض", lastName: "سباق" + i, phone: "05" + String(20000000 + i),
          wilayaId: created.wilayaId, specialtyId: created.specialtyId, doctorId: d.id, date, startTime: "09:00",
        }, patientToken, i)
      )
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(49);
    expect(await db.appointment.count({ where: { doctorId: d.id } })).toBe(1);
  });

  it("40 نداء 'التالي' متزامنًا → مريض واحد فقط بالداخل", async () => {
    const d = await mkDoctor("next");
    for (let k = 0; k < 20; k++) {
      await db.appointment.create({
        data: { doctorId: d.id, date: today, startTime: `${String(8 + Math.floor(k / 3)).padStart(2, "0")}:${String((k % 3) * 20).padStart(2, "0")}`, endTime: "23:59", status: "CONFIRMED", guestFirstName: "g" + k, guestLastName: "x", guestPhone: "05" + String(30000000 + k) },
      });
    }
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => call("POST", "/api/appointments/queue/next", undefined, d.token, i)));
    expect(rs.some((r) => r.status >= 500)).toBe(false);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.appointment.count({ where: { doctorId: d.id, status: "IN_PROGRESS" } })).toBe(1);
  });

  it("30 طلب 'لم يحضر' متزامنًا لنفس الموعد → فائز واحد وسجل SMS واحد", async () => {
    const d = await mkDoctor("noshow");
    const a = await db.appointment.create({
      data: { doctorId: d.id, date: today, startTime: "08:00", endTime: "08:20", status: "CONFIRMED", guestFirstName: "g", guestLastName: "x", guestPhone: "0551234567" },
    });
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call("PATCH", "/api/appointments/" + a.id, { status: "NO_SHOW" }, d.token, i)));
    expect(rs.some((r) => r.status >= 500)).toBe(false);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(29);
    expect(await db.smsLog.count({ where: { appointmentId: a.id } })).toBe(1);
  });

  it("150 حجز تلقائي لطبيب واحد بمجمّع من 5 اتصالات → بلا 500 ولا تكرار ولا فقدان", async () => {
    const d = await mkDoctor("hot");
    const rs = await Promise.all(
      Array.from({ length: 150 }, (_, i) =>
        call("POST", "/api/booking", {
          firstName: "مريض", lastName: "ساخن" + i, phone: "05" + String(60000000 + i),
          wilayaId: created.wilayaId, specialtyId: created.specialtyId, doctorId: d.id,
        }, patientToken, i)
      )
    );
    expect(rs.filter((r) => r.status >= 500)).toHaveLength(0);
    const ok = rs.filter((r) => r.status === 201);
    expect(ok).toHaveLength(150);
    const rows = await db.appointment.findMany({ where: { doctorId: d.id }, select: { id: true, date: true, startTime: true, guestPhone: true } });
    expect(rows).toHaveLength(150);
    expect(new Set(rows.map((r) => `${r.date.toISOString()}|${r.startTime}`)).size).toBe(150);
    expect(new Set(rows.map((r) => r.guestPhone)).size).toBe(150);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(ok.map((r) => r.data.id)));
  });
});
