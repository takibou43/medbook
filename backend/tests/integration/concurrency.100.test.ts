/**
 * اختبار تزامن حقيقي (Concurrency) للحجز: 10 أطباء × 10 طلبات = 100 طلب POST /api/booking متزامنة.
 *
 * - يعمل فقط عند ضبط TEST_DATABASE_URL، ويرفض أي قاعدة ليست محلية (localhost/127.0.0.1)
 *   أو لا يحتوي اسمها على "test" — حتى لا يمكن تشغيله على Production بالخطأ.
 * - يحاكي طلبات HTTP حقيقية عبر خادم Express مفتوح على منفذ محلي (وليس استدعاء دوال مباشرة).
 * - النجاح لا يُقاس بـ HTTP 201 وحدها، بل بفحص قاعدة البيانات نفسها بعد انتهاء كل الطلبات.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:54329/medbook_test?schema=public" npm test -- concurrency
 * (يجب أن تكون قاعدة الاختبار قد أُنشئت بـ `prisma db push`).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import { PrismaClient } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;

export function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  const dbName = u.pathname.replace(/^\//, "");
  if (!okHost || !/test/i.test(dbName)) {
    throw new Error(`رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي "test" (الحالي: ${u.hostname}/${dbName}).`);
  }
}

const DOCTORS = 10;
const PER_DOCTOR = 10;
const TOTAL = DOCTORS * PER_DOCTOR;
const SLOT_MIN = 20;

describe.skipIf(!TEST_URL)("Concurrency: 10 أطباء × 10 حجوزات متزامنة", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  const created = { userIds: [] as string[], doctorIds: [] as string[], wilayaId: "", cityId: "", specialtyId: "" };
  const tag = `conc${Date.now().toString(36)}`;
  let patientUserId = "";
  let patientToken = ""; // الحجز يتطلب حساب مريض مسجّل الدخول

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    process.env.RATE_LIMIT_MAX = "1000000"; // الاختبار وحده؛ لا يمس إعدادات الإنتاج
    db = new PrismaClient({ datasourceUrl: TEST_URL });

    const wilaya = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const city = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: wilaya.id } });
    const specialty = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(created, { wilayaId: wilaya.id, cityId: city.id, specialtyId: specialty.id });

    for (let i = 0; i < DOCTORS; i++) {
      const user = await db.user.create({
        data: { email: `${tag}-doc${i}@test.local`, passwordHash: "x", role: "DOCTOR" },
      });
      const doctor = await db.doctor.create({
        data: {
          userId: user.id,
          firstName: `طبيب${i}`,
          lastName: tag,
          specialtyId: specialty.id,
          wilayaId: wilaya.id,
          cityId: city.id,
          slotDurationMin: SLOT_MIN,
          verificationStatus: "VERIFIED",
          subscriptionStatus: "ACTIVE",
          schedules: {
            create: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startTime: "00:00", endTime: "23:59" })),
          },
        },
      });
      created.userIds.push(user.id);
      created.doctorIds.push(doctor.id);
    }

    const pu = await db.user.create({
      data: { email: `${tag}-patient@test.local`, passwordHash: "x", role: "PATIENT", patient: { create: { firstName: "مريض", lastName: tag } } },
    });
    patientUserId = pu.id;
    const { signAccessToken } = await import("../../src/utils/jwt");
    patientToken = signAccessToken({ sub: pu.id, role: "PATIENT" });

    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (db) {
      await db.notification.deleteMany({ where: { userId: { in: created.userIds } } });
      await db.appointment.deleteMany({ where: { doctorId: { in: created.doctorIds } } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: { in: created.doctorIds } } });
      await db.doctor.deleteMany({ where: { id: { in: created.doctorIds } } });
      await db.user.deleteMany({ where: { id: { in: [...created.userIds, patientUserId].filter(Boolean) } } });
      await db.specialty.deleteMany({ where: { id: created.specialtyId } });
      await db.city.deleteMany({ where: { id: created.cityId } });
      await db.wilaya.deleteMany({ where: { id: created.wilayaId } });
      await db.$disconnect();
    }
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  it("100 طلب متزامن → 100 حجز صحيح بلا تكرار ولا فقدان ولا ثغرات في الطابور", async () => {
    const { generateAvailableSlots, isPast, algeriaTodayUTCMidnight } = await import("../../src/lib/slots");

    // ---- الطابور المتوقع لطبيب فارغ: أول 10 أدوار متاحة (نفس قاعدة النظام) ----
    const schedules = Array.from({ length: 7 }, (_, d) => ({
      dayOfWeek: d, startTime: "00:00", endTime: "23:59", isException: false, exceptionDate: null, isOff: false,
    }));
    const expectedSlots: string[] = [];
    for (let day = 0; expectedSlots.length < PER_DOCTOR && day < 5; day++) {
      const date = algeriaTodayUTCMidnight();
      date.setUTCDate(date.getUTCDate() + day);
      for (const s of generateAvailableSlots(date, schedules, [], SLOT_MIN)) {
        if (!isPast(date, s) && expectedSlots.length < PER_DOCTOR) expectedSlots.push(`${date.toISOString().slice(0, 10)} ${s}`);
      }
    }

    // ---- 100 طلب: كلٌّ بهاتف واسم فريدين لتمييز الحجز المكرر والمفقود ----
    const reqs = Array.from({ length: TOTAL }, (_, n) => ({
      n,
      doctorId: created.doctorIds[n % DOCTORS],
      phone: `05${String(10000000 + n)}`,
      body: {
        firstName: `مريض${n}`,
        lastName: "اختبار",
        phone: `05${String(10000000 + n)}`,
        wilayaId: created.wilayaId,
        specialtyId: created.specialtyId,
        doctorId: created.doctorIds[n % DOCTORS],
      },
    }));

    // كل الطلبات تنطلق في نفس اللحظة (Promise.all على وعود بدأت كلها قبل أول await).
    const t0 = Date.now();
    const results = await Promise.all(
      reqs.map(async (r) => {
        try {
          const res = await fetch(`${base}/api/booking`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${patientToken}` },
            body: JSON.stringify(r.body),
          });
          const json: any = await res.json().catch(() => ({}));
          return { ...r, status: res.status, json };
        } catch (e: any) {
          return { ...r, status: 0, json: { message: String(e?.message ?? e) } };
        }
      })
    );
    const elapsedMs = Date.now() - t0;

    // ---- الفحص من قاعدة البيانات نفسها ----
    const rows = await db.appointment.findMany({
      where: { doctorId: { in: created.doctorIds } },
      orderBy: [{ doctorId: "asc" }, { date: "asc" }, { startTime: "asc" }],
    });
    const notifications = await db.notification.groupBy({
      by: ["userId"],
      where: { userId: { in: created.userIds }, type: "APPOINTMENT_CREATED" },
      _count: { _all: true },
    });
    const idleInTx: any[] = await db.$queryRaw`SELECT count(*)::int AS c FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`;
    const uniqueIdx: any[] = await db.$queryRaw`SELECT indexdef FROM pg_indexes WHERE tablename = 'appointments' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%doctorId%' AND indexdef ILIKE '%startTime%'`;
    const dupSlots: any[] = await db.$queryRaw`SELECT "doctorId", date, "startTime", count(*)::int AS c FROM appointments WHERE "doctorId" = ANY(${created.doctorIds}) GROUP BY 1,2,3 HAVING count(*) > 1`;

    const ok = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status !== 201);
    const statusHistogram: Record<string, number> = {};
    for (const r of results) statusHistogram[r.status] = (statusHistogram[r.status] ?? 0) + 1;

    const rowsByPhone = new Map<string, typeof rows>();
    for (const row of rows) {
      const k = row.guestPhone ?? "";
      rowsByPhone.set(k, [...(rowsByPhone.get(k) ?? []), row]);
    }
    // فقدان: ردّ 201 لكن لا سجل في القاعدة (أو معرّفه مختلف)
    const lostBookings = ok.filter((r) => !rows.some((row) => row.id === r.json?.data?.id)).length;
    // تكرار: أكثر من سجل لنفس الطلب (نفس الهاتف الفريد)
    const duplicateBookings = [...rowsByPhone.values()].filter((v) => v.length > 1).reduce((s, v) => s + v.length - 1, 0);
    // طلب أُخطر بفشله لكن سجله موجود (حجز "شبح")
    const ghostBookings = failed.filter((r) => rowsByPhone.has(r.phone)).length;
    // الطلب وُضع عند غير الطبيب المطلوب (تسرّب بين الطوابير)
    const wrongDoctor = results.filter((r) => rowsByPhone.get(r.phone)?.some((row) => row.doctorId !== r.doctorId)).length;
    const transactionErrors = results.filter((r) => r.status >= 500 || r.status === 0).length;

    let duplicateQueueNumbers = dupSlots.length;
    let gapsOrWrongOrder = 0;
    const perDoctor: Record<string, number> = {};
    for (const id of created.doctorIds) {
      const list = rows.filter((r) => r.doctorId === id);
      perDoctor[id.slice(0, 8)] = list.length;
      const keys = list.map((r) => `${r.date.toISOString().slice(0, 10)} ${r.startTime}`);
      if (new Set(keys).size !== keys.length) duplicateQueueNumbers += keys.length - new Set(keys).size;
      // الترتيب الصحيح: الأدوار المحجوزة = أول N دور متاح بلا ثغرة، متسلسلة تصاعديًا
      if (JSON.stringify(keys) !== JSON.stringify(expectedSlots.slice(0, keys.length))) gapsOrWrongOrder++;
    }
    const partialRecords = rows.filter(
      (r) => !r.guestFirstName || !r.guestLastName || !r.endTime || r.status !== "CONFIRMED"
    ).length;
    const notifMismatch = created.userIds.filter(
      (uid, i) => (notifications.find((n) => n.userId === uid)?._count._all ?? 0) !== rows.filter((r) => r.doctorId === created.doctorIds[i]).length
    ).length;

    const report = {
      requests: TOTAL,
      elapsedMs,
      successful201: ok.length,
      failed: failed.length,
      statusHistogram,
      failureMessages: [...new Set(failed.map((f) => `${f.status}: ${f.json?.message}`))],
      dbRows: rows.length,
      perDoctor,
      duplicateQueueNumbers,
      lostBookings,
      duplicateBookings,
      ghostBookings,
      wrongDoctor,
      transactionErrors,
      gapsOrWrongOrderDoctors: gapsOrWrongOrder,
      partialRecords,
      notificationMismatchDoctors: notifMismatch,
      idleInTransaction: idleInTx[0]?.c,
      uniqueIndexPresent: uniqueIdx.length > 0,
    };
    console.log("CONCURRENCY_REPORT " + JSON.stringify(report));
    if (process.env.CONC_REPORT) fs.writeFileSync(process.env.CONC_REPORT, JSON.stringify(report, null, 2));

    expect(report.uniqueIndexPresent).toBe(true);
    expect(report.successful201).toBe(TOTAL);
    expect(report.failed).toBe(0);
    expect(report.dbRows).toBe(TOTAL);
    expect(report.duplicateQueueNumbers).toBe(0);
    expect(report.lostBookings).toBe(0);
    expect(report.duplicateBookings).toBe(0);
    expect(report.ghostBookings).toBe(0);
    expect(report.wrongDoctor).toBe(0);
    expect(report.transactionErrors).toBe(0);
    expect(report.gapsOrWrongOrderDoctors).toBe(0);
    expect(report.partialRecords).toBe(0);
    expect(report.notificationMismatchDoctors).toBe(0);
    expect(report.idleInTransaction).toBe(0);
    for (const id of created.doctorIds) expect(rows.filter((r) => r.doctorId === id).length).toBe(PER_DOCTOR);
  }, 120000);
});
