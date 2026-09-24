/**
 * Race Condition: عدة مرضى مختلفين يحجزون نفس (الطبيب + التاريخ + startTime) في نفس اللحظة.
 *
 * يعمل على قاعدة اختبار محلية فقط (يُرفض أي host غير محلي أو اسم قاعدة بلا "test")، ويُتخطى دون TEST_DATABASE_URL.
 * لا يمرّ عبر الواجهة إطلاقًا: طلبات HTTP مباشرة إلى خادم Express حقيقي، ثم إدراجات مباشرة في القاعدة
 * لإثبات أن المنع مضمون في الـbackend/قاعدة البيانات وليس في فحص الواجهة.
 *
 *  A) 100 مريض × POST /api/booking لنفس الوقت                      → 1 ناجح، 99 مرفوض 409، 0 أخطاء 5xx
 *  B) نفس الشيء مع موعد CANCELLED مسبق على نفس الوقت (activeSlot=NULL) → 1 نشط فقط، والملغى لم يُلمس
 *  C) 100 مريض موزّعون على المسارين POST /api/booking و POST /api/appointments → 1 ناجح إجمالًا
 *  D) 100 إدراج مباشر متزامن في القاعدة (بلا أي منطق تطبيق)          → 1 ناجح، 99 P2002
 *  E) 50 موعدًا ملغى على نفس الوقت يُعاد تفعيلها (CANCELLED→CONFIRMED) متزامنًا → نشط واحد فقط
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:54329/medbook_test?schema=public" npx vitest run sameSlotRace
 * تقرير JSON اختياري: RACE_REPORT=path/to/report.json
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import type { AddressInfo } from "net";
import { PrismaClient, Prisma } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
const N = 100;
const SLOT = "10:00";

function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  const dbName = u.pathname.replace(/^\//, "");
  if (!okHost || !/test/i.test(dbName)) throw new Error(`رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي "test".`);
}

const report: Record<string, unknown> = {};

describe.skipIf(!TEST_URL)("Race Condition — نفس الطبيب + نفس التاريخ + نفس startTime", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let signAccessToken: (p: { sub: string; role: any }) => string;
  let today: Date;
  const tag = `ss${Date.now().toString(36)}`;
  const created = { userIds: [] as string[], doctorIds: [] as string[], wilayaId: "", cityId: "", specialtyId: "" };
  // 100 مريض مختلف، لكل واحد حسابه وتوكنه.
  const patients: { userId: string; patientId: string; token: string }[] = [];

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
    return { id: doctor.id, userId: user.id };
  }

  const call = async (method: string, url: string, body: unknown, token: string, i: number) => {
    const r = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(i % 250) + 1}`, authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, data: j?.data, message: j?.message as string | undefined };
  };

  /** كل الطلبات تُجهَّز أولًا ثم تنطلق معًا عند إشارة واحدة (بوابة)، فتصل في نفس اللحظة تقريبًا. */
  async function fireTogether<T>(n: number, mk: (i: number) => Promise<T>) {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const sentAt: number[] = [];
    const ps = Array.from({ length: n }, (_, i) =>
      gate.then(() => {
        sentAt[i] = performance.now();
        return mk(i);
      })
    );
    const t0 = performance.now();
    open();
    const rs = await Promise.all(ps);
    return { rs, dispatchSpreadMs: Math.max(...sentAt) - Math.min(...sentAt), totalMs: performance.now() - t0 };
  }

  const dateStr = (plusDays: number) => new Date(today.getTime() + plusDays * 86400000).toISOString().slice(0, 10);

  async function slotRows(doctorId: string, date: string) {
    return db.appointment.findMany({
      where: { doctorId, date: new Date(date + "T00:00:00Z"), startTime: SLOT },
      select: { id: true, status: true, activeSlot: true, patientId: true },
    });
  }

  /** فحص الاتساق العام لقاعدة البيانات: لا يوجد في أي مكان موعدان نشطان على نفس (طبيب، تاريخ، وقت). */
  async function globalDuplicates() {
    const r = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM (
        SELECT "doctorId","date","startTime" FROM "appointments"
        WHERE "status" <> 'CANCELLED'
        GROUP BY 1,2,3 HAVING count(*) > 1
      ) d`;
    return Number(r[0].n);
  }
  async function inconsistentActiveSlot() {
    const r = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "appointments"
      WHERE ("status" = 'CANCELLED' AND "activeSlot" IS NOT NULL)
         OR ("status" <> 'CANCELLED' AND "activeSlot" IS DISTINCT FROM true)`;
    return Number(r[0].n);
  }

  function summarize(rs: { status: number; message?: string }[]) {
    const by: Record<string, number> = {};
    for (const r of rs) by[r.status] = (by[r.status] ?? 0) + 1;
    return by;
  }

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    const sep = TEST_URL!.includes("?") ? "&" : "?";
    // مجمّع اتصالات واسع حتى تصل الطلبات إلى قاعدة البيانات متوازية فعلًا (لا تُسلسَل في المجمّع).
    process.env.DATABASE_URL = TEST_URL + sep + "connection_limit=40&pool_timeout=60";
    process.env.RATE_LIMIT_MAX = "1000000";
    // مجموع المجمّعين (40 للخادم + 30 هنا) أقل من max_connections=100 الافتراضي، وإلا ظهر P2037 وهو قيد بيئة لا سباق.
    db = new PrismaClient({ datasourceUrl: TEST_URL + sep + "connection_limit=30&pool_timeout=60" });
    const wilaya = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const city = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: wilaya.id } });
    const specialty = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(created, { wilayaId: wilaya.id, cityId: city.id, specialtyId: specialty.id });
    ({ signAccessToken } = await import("../../src/utils/jwt"));
    today = (await import("../../src/lib/slots")).algeriaTodayUTCMidnight();
    for (let i = 0; i < N; i++) {
      const u = await db.user.create({
        data: { email: `${tag}-p${i}@test.local`, passwordHash: "x", role: "PATIENT", patient: { create: { firstName: "مريض", lastName: `${tag}${i}` } } },
        include: { patient: true },
      });
      created.userIds.push(u.id);
      patients.push({ userId: u.id, patientId: u.patient!.id, token: signAccessToken({ sub: u.id, role: "PATIENT" }) });
    }
    const { createApp } = await import("../../src/app");
    server = http.createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // تسخين: أول طلب يحمّل وحدات Prisma/Express حتى لا يُحسب بطؤه ضمن السباق.
    await fetch(base + "/health").catch(() => {});
  }, 120000);

  afterAll(async () => {
    server?.close();
    if (process.env.RACE_REPORT) fs.writeFileSync(process.env.RACE_REPORT, JSON.stringify(report, null, 2));
    if (db) {
      const ids = created.doctorIds;
      await db.appointmentService.deleteMany({ where: { appointment: { doctorId: { in: ids } } } });
      await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: ids } } } });
      await db.appointment.deleteMany({ where: { doctorId: { in: ids } } });
      await db.notification.deleteMany({ where: { userId: { in: created.userIds } } });
      await db.doctorSchedule.deleteMany({ where: { doctorId: { in: ids } } });
      await db.doctor.deleteMany({ where: { id: { in: ids } } });
      await db.patient.deleteMany({ where: { userId: { in: created.userIds } } });
      await db.user.deleteMany({ where: { id: { in: created.userIds } } });
      await db.specialty.deleteMany({ where: { id: created.specialtyId } });
      await db.city.deleteMany({ where: { id: created.cityId } });
      await db.wilaya.deleteMany({ where: { id: created.wilayaId } });
      await db.$disconnect();
    }
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });

  const bookingBody = (doctorId: string, date: string, i: number) => ({
    firstName: "مريض", lastName: "سباق" + i, phone: "05" + String(40000000 + i),
    wilayaId: created.wilayaId, specialtyId: created.specialtyId, doctorId, date, startTime: SLOT,
  });

  async function assertOneWinner(
    name: string,
    doctor: { id: string; userId: string },
    date: string,
    out: Awaited<ReturnType<typeof fireTogether<{ status: number; data: any; message?: string }>>>,
    extraRowsExpected = 0
  ) {
    const { rs } = out;
    const ok = rs.filter((r) => r.status === 201);
    const conflicts = rs.filter((r) => r.status === 409);
    const rows = await slotRows(doctor.id, date);
    const active = rows.filter((r) => r.status !== "CANCELLED");
    const notifs = await db.notification.count({ where: { userId: doctor.userId, type: "APPOINTMENT_CREATED" } });
    report[name] = {
      attempts: rs.length, statuses: summarize(rs), succeeded: ok.length, rejected: rs.length - ok.length,
      activeRowsAtSlot: active.length, totalRowsAtSlot: rows.length, doctorNotifications: notifs,
      dispatchSpreadMs: Math.round(out.dispatchSpreadMs * 10) / 10, totalMs: Math.round(out.totalMs),
      rejectionMessages: [...new Set(conflicts.map((r) => r.message))],
    };
    expect(rs.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(rs.length - 1);
    expect(active).toHaveLength(1);
    expect(active[0].activeSlot).toBe(true);
    expect(active[0].id).toBe(ok[0].data.id); // الصف المحفوظ هو نفسه الذي أُبلغ صاحبه بالنجاح
    expect(rows).toHaveLength(1 + extraRowsExpected); // لا صفوف جزئية/يتيمة من المحاولات المرفوضة
    expect(await db.appointment.count({ where: { doctorId: doctor.id } })).toBe(1 + extraRowsExpected);
    expect(notifs).toBe(1); // إشعار واحد للطبيب = حجز واحد فقط اكتمل
    return ok[0];
  }

  it(`A) ${N} مريضًا مختلفًا × POST /api/booking لنفس الوقت → حجز واحد فقط`, async () => {
    const d = await mkDoctor("A");
    const date = dateStr(2);
    const out = await fireTogether(N, (i) => call("POST", "/api/booking", bookingBody(d.id, date, i), patients[i].token, i));
    const win = await assertOneWinner("A_booking_endpoint", d, date, out);
    const row = await db.appointment.findUnique({ where: { id: win.data.id } });
    // صاحب الموعد هو مريض الجلسة الفائز نفسه (من التوكن، لا من الجسم).
    expect(patients.map((p) => p.patientId)).toContain(row!.patientId);
  });

  it(`B) مع موعد CANCELLED مسبق على نفس الوقت → حجز نشط واحد فقط والملغى لم يتغيّر`, async () => {
    const d = await mkDoctor("B");
    const date = dateStr(3);
    const cancelled = await db.appointment.create({
      data: { doctorId: d.id, date: new Date(date + "T00:00:00Z"), startTime: SLOT, endTime: "10:20", status: "CANCELLED", guestFirstName: "ملغى", guestLastName: "x" },
    });
    expect(cancelled.activeSlot).toBeNull(); // الـtrigger حرّر الوقت
    const out = await fireTogether(N, (i) => call("POST", "/api/booking", bookingBody(d.id, date, i), patients[i].token, i));
    await assertOneWinner("B_with_cancelled_row", d, date, out, 1);
    const after = await db.appointment.findUnique({ where: { id: cancelled.id } });
    expect(after!.status).toBe("CANCELLED");
    expect(after!.activeSlot).toBeNull();
    expect(after!.updatedAt.getTime()).toBe(cancelled.updatedAt.getTime());
  });

  it(`C) ${N} مريضًا موزّعين على المسارين /api/booking و /api/appointments → حجز واحد إجمالًا`, async () => {
    const d = await mkDoctor("C");
    const date = dateStr(4);
    const out = await fireTogether(N, (i) =>
      i % 2 === 0
        ? call("POST", "/api/booking", bookingBody(d.id, date, i), patients[i].token, i)
        : call("POST", "/api/appointments", { doctorId: d.id, date, startTime: SLOT }, patients[i].token, i)
    );
    await assertOneWinner("C_both_endpoints", d, date, out);
  });

  it(`D) ${N} إدراجًا مباشرًا متزامنًا في القاعدة (بلا منطق التطبيق) → صف نشط واحد والباقي P2002`, async () => {
    const d = await mkDoctor("D");
    const date = new Date(dateStr(5) + "T00:00:00Z");
    // تسخين مجمّع اتصالات عميل الاختبار حتى لا يتزامن فتح 30 اتصالًا جديدًا مع السباق نفسه.
    await Promise.all(Array.from({ length: 30 }, () => db.$queryRaw`SELECT 1`));
    // أخطاء الاتصال (P1001/P2037/P2024) قيد بيئة Postgres المحلية على Windows وليست نتيجة للسباق:
    // تُعاد المحاولة نفسها فقط، فيبقى الشرط الصارم أن كل محاولة خاسرة رُفضت بالقيد الفريد (P2002).
    const CONN_ERRORS = new Set(["P1001", "P2037", "P2024"]);
    let connRetries = 0;
    const insert = async (i: number): Promise<string> => {
      for (let k = 0; ; k++) {
        try {
          await db.appointment.create({ data: { doctorId: d.id, patientId: patients[i].patientId, date, startTime: SLOT, endTime: "10:20", status: "CONFIRMED" } });
          return "ok";
        } catch (e) {
          const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e);
          if (CONN_ERRORS.has(code) && k < 5) { connRetries++; await new Promise((r) => setTimeout(r, 50)); continue; }
          return code;
        }
      }
    };
    const out = await fireTogether(N, insert);
    const codes: Record<string, number> = {};
    for (const c of out.rs) codes[c] = (codes[c] ?? 0) + 1;
    const rows = await db.appointment.findMany({ where: { doctorId: d.id } });
    report.D_direct_db_inserts = { attempts: N, results: codes, connectionRetries: connRetries, rowsAtSlot: rows.length, dispatchSpreadMs: Math.round(out.dispatchSpreadMs * 10) / 10 };
    expect(codes.ok).toBe(1);
    expect(codes.P2002).toBe(N - 1);
    expect(rows).toHaveLength(1);
  });

  it(`E) 50 موعدًا ملغى على نفس الوقت يُعاد تفعيلها متزامنًا → لا يصبح نشطًا إلا واحد`, async () => {
    const d = await mkDoctor("E");
    const date = new Date(dateStr(6) + "T00:00:00Z");
    const cancelledIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const a = await db.appointment.create({
        data: { doctorId: d.id, patientId: patients[i].patientId, date, startTime: SLOT, endTime: "10:20", status: "CANCELLED" },
      });
      cancelledIds.push(a.id);
    }
    const out = await fireTogether(50, (i) =>
      db.appointment
        .update({ where: { id: cancelledIds[i] }, data: { status: "CONFIRMED" } })
        .then(() => "ok" as const)
        .catch((e) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e)))
    );
    const codes: Record<string, number> = {};
    for (const c of out.rs) codes[c] = (codes[c] ?? 0) + 1;
    const active = await db.appointment.count({ where: { doctorId: d.id, status: { not: "CANCELLED" } } });
    report.E_reactivate_cancelled = { attempts: 50, results: codes, activeRowsAtSlot: active };
    expect(codes.ok).toBe(1);
    expect(active).toBe(1);
  });

  it("اتساق عام: لا تكرار نشط في أي مكان، وactiveSlot مطابق للحالة في كل الصفوف", async () => {
    const dup = await globalDuplicates();
    const bad = await inconsistentActiveSlot();
    const idle = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE state = 'idle in transaction'`;
    report.global = { duplicateActiveSlots: dup, inconsistentActiveSlotRows: bad, idleInTransaction: Number(idle[0].n) };
    expect(dup).toBe(0);
    expect(bad).toBe(0);
    expect(Number(idle[0].n)).toBe(0);
  });
});
