/**
 * Race Condition — عدة مرضى يطلبون نفس (الطبيب + التاريخ + startTime) في نفس اللحظة.
 *
 * السلوك المطلوب (منذ «أقرب موعد متاح»): لا يُرفض أحد بسبب السباق. من تُثبَّت معاملته أولًا في قاعدة البيانات
 * (أول من يحصل على قفل طابور الطبيب pg_advisory_xact_lock ثم commit) يأخذ الوقت المطلوب، وكل طلب بعده يأخذ
 * أول وقت صالح وشاغر بعد الوقت المطلوب في نفس اليوم. الأولوية إذن ترتيب نجاح المعاملات في القاعدة، لا ترتيب
 * وصول طلبات HTTP — ويتحقق الاختبار A من ذلك: كلما كان createdAt (المحسوب داخل المعاملة بعد القفل) أقدم كان
 * الوقت أبكر. القيد الفريد (doctorId, date, startTime, activeSlot) يبقى فعّالًا طوال الاختبار (D و E).
 *
 * يعمل على قاعدة اختبار محلية فقط (يُرفض أي host غير محلي أو اسم قاعدة بلا "test")، ويُتخطى دون TEST_DATABASE_URL.
 * لا يمرّ عبر الواجهة إطلاقًا: طلبات HTTP مباشرة إلى خادم Express حقيقي + إدراجات مباشرة في القاعدة.
 *
 *  A) 100 مريض × POST /api/booking لنفس الوقت          → 100 حجز، 100 وقت مختلف = أول 100 وقت متتالٍ من المطلوب
 *  B) 50 على وقت و50 على وقت تالٍ (نصفهم عبر POST /api/appointments) → 100 حجز، لا أحد قبل وقته المطلوب
 *  C) مواعيد محجوزة مسبقًا (CONFIRMED / COMPLETED / NO_SHOW / IN_PROGRESS) بين الأوقات → لا حجز فوقها ولا تعديل لها
 *  F) أوقات CANCELLED بين الأوقات → تُعاد استعمالها، والسجلات الملغاة لم تُمسّ
 *  G) يوم ممتلئ: 30 طلبًا على طبيب بـ12 وقتًا فقط → 12 حجزًا داخل الدوام و18 رفضًا 409 بالرسالة الحالية، بلا حلقة
 *  H) سباق أثناء اختيار الوقت البديل: 100 طلب HTTP + 60 إدراجًا مباشرًا (خارج القفل) على الأوقات التالية
 *     → كل طلبات HTTP تنجح بلا تكرار (P2002 يُعالَج بإعادة الحساب)
 *  D) 100 إدراج مباشر متزامن في القاعدة (بلا منطق التطبيق) → صف واحد، 99 × P2002 (القيد ما زال فعّالًا)
 *  E) 50 موعدًا ملغى على نفس الوقت يُعاد تفعيلها متزامنًا → نشط واحد فقط
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_race_test?schema=public" npx vitest run sameSlotRace
 * تقرير JSON اختياري: RACE_REPORT=path/to/report.json
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import type { AddressInfo } from "net";
import { PrismaClient, Prisma } from "@prisma/client";

const TEST_URL = process.env.TEST_DATABASE_URL;
const N = 100;
const DUR = 5; // مدة جلسة الطبيب بالدقائق (slotDurationMin)
const REQ = "08:00"; // الوقت الذي يطلبه الجميع

function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  const dbName = u.pathname.replace(/^\//, "");
  if (!okHost || !/test/i.test(dbName)) throw new Error(`رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي "test".`);
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** أوقات الشبكة المتتالية من وقت معيّن (بمدة الجلسة)، مع استبعاد أوقات مشغولة. */
function gridFrom(start: string, count: number, skip: string[] = []) {
  const out: string[] = [];
  for (let m = toMin(start); out.length < count; m += DUR) if (!skip.includes(toHHMM(m))) out.push(toHHMM(m));
  return out;
}

type Res = { status: number; data: any; message?: string };
const report: Record<string, unknown> = {};

describe.skipIf(!TEST_URL)("Race Condition — نفس الطبيب + نفس التاريخ + نفس startTime → أقرب موعد متاح", () => {
  let server: http.Server;
  let base: string;
  let db: PrismaClient;
  let signAccessToken: (p: { sub: string; role: any }) => string;
  let slotAssign: typeof import("../../src/lib/slotAssign");
  let today: Date;
  const tag = `ss${Date.now().toString(36)}`;
  const created = { userIds: [] as string[], doctorIds: [] as string[], wilayaId: "", cityId: "", specialtyId: "" };
  // 100 مريض مختلف، لكل واحد حسابه وتوكنه.
  const patients: { userId: string; patientId: string; token: string }[] = [];

  async function mkDoctor(i: string, start = "06:00", end = "22:00") {
    const user = await db.user.create({ data: { email: `${tag}-${i}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    const doctor = await db.doctor.create({
      data: {
        userId: user.id, firstName: "د" + i, lastName: tag, specialtyId: created.specialtyId, wilayaId: created.wilayaId,
        cityId: created.cityId, slotDurationMin: DUR, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startTime: start, endTime: end })) },
      },
    });
    created.userIds.push(user.id);
    created.doctorIds.push(doctor.id);
    return { id: doctor.id, userId: user.id, start, end };
  }

  const call = async (method: string, url: string, body: unknown, token: string, i: number): Promise<Res> => {
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
  const dateObj = (d: string) => new Date(d + "T00:00:00Z");
  const bookingBody = (doctorId: string, date: string, i: number, startTime = REQ) => ({
    firstName: "مريض", lastName: "سباق" + i, phone: "05" + String(40000000 + i),
    wilayaId: created.wilayaId, specialtyId: created.specialtyId, doctorId, date, startTime,
  });

  async function globalDuplicates() {
    const r = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM (
        SELECT "doctorId","date","startTime" FROM "appointments"
        WHERE "status" <> 'CANCELLED'
        GROUP BY 1,2,3 HAVING count(*) > 1
      ) d`;
    return Number(r[0].n);
  }
  /** تداخل زمني بين موعدين نشطين لنفس الطبيب في نفس اليوم (أقوى من تطابق startTime). */
  async function overlaps(doctorId: string) {
    const rows = await db.appointment.findMany({ where: { doctorId, status: { not: "CANCELLED" } }, select: { date: true, startTime: true, endTime: true } });
    let n = 0;
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++)
        if (rows[i].date.getTime() === rows[j].date.getTime() && toMin(rows[i].startTime) < toMin(rows[j].endTime) && toMin(rows[j].startTime) < toMin(rows[i].endTime)) n++;
    return n;
  }
  async function inconsistentActiveSlot() {
    const r = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "appointments"
      WHERE ("status" = 'CANCELLED' AND "activeSlot" IS NOT NULL)
         OR ("status" <> 'CANCELLED' AND "activeSlot" IS DISTINCT FROM true)`;
    return Number(r[0].n);
  }
  function summarize(rs: { status: number }[]) {
    const by: Record<string, number> = {};
    for (const r of rs) by[r.status] = (by[r.status] ?? 0) + 1;
    return by;
  }
  const uniqueConstraintPresent = async () =>
    Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_indexes WHERE indexname = 'appointments_doctorId_date_startTime_activeSlot_key'`)[0].n) === 1;

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    const sep = TEST_URL!.includes("?") ? "&" : "?";
    // مجمّع اتصالات واسع حتى تصل الطلبات إلى قاعدة البيانات متوازية فعلًا (لا تُسلسَل في المجمّع).
    process.env.DATABASE_URL = TEST_URL + sep + "connection_limit=40&pool_timeout=60";
    process.env.RATE_LIMIT_MAX = "1000000";
    process.env.REMINDERS_ENABLED = "false";
    // مجموع المجمّعين (40 للخادم + 30 هنا) أقل من max_connections=100 الافتراضي، وإلا ظهر P2037 وهو قيد بيئة لا سباق.
    db = new PrismaClient({ datasourceUrl: TEST_URL + sep + "connection_limit=30&pool_timeout=60" });
    const wilaya = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const city = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: wilaya.id } });
    const specialty = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(created, { wilayaId: wilaya.id, cityId: city.id, specialtyId: specialty.id });
    ({ signAccessToken } = await import("../../src/utils/jwt"));
    today = (await import("../../src/lib/slots")).algeriaTodayUTCMidnight();
    slotAssign = await import("../../src/lib/slotAssign");
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
    await fetch(base + "/health").catch(() => {});
    expect(await uniqueConstraintPresent()).toBe(true);
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

  /** فحوص مشتركة لكل سيناريو HTTP ناجح بالكامل. */
  async function assertAllBooked(
    name: string,
    doctor: { id: string; userId: string; start: string; end: string },
    date: string,
    out: { rs: Res[]; dispatchSpreadMs: number; totalMs: number },
    expectedTimes: string[],
    preExistingActive = 0
  ) {
    const { rs } = out;
    const ok = rs.filter((r) => r.status === 201);
    const times = ok.map((r) => r.data.startTime as string).sort();
    const rows = await db.appointment.findMany({ where: { doctorId: doctor.id, date: dateObj(date) }, orderBy: { startTime: "asc" } });
    const active = rows.filter((r) => r.status !== "CANCELLED");
    const notifs = await db.notification.findMany({ where: { userId: doctor.userId, type: "APPOINTMENT_CREATED", appointmentId: { in: ok.map((r) => r.data.id) } } });
    const byId = new Map(active.map((r) => [r.id, r]));
    report[name] = {
      attempts: rs.length, statuses: summarize(rs), succeeded: ok.length, failed: rs.length - ok.length,
      distinctStartTimes: new Set(times).size, duplicates: times.length - new Set(times).size,
      gotRequestedTime: ok.filter((r) => !r.data.shiftedFromRequested).length, shifted: ok.filter((r) => r.data.shiftedFromRequested).length,
      firstTime: times[0], lastTime: times[times.length - 1],
      dispatchSpreadMs: Math.round(out.dispatchSpreadMs * 10) / 10, totalMs: Math.round(out.totalMs), startTimes: times,
    };
    expect(rs.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(ok).toHaveLength(rs.length); // 0 فشل بسبب السباق
    expect(new Set(times).size).toBe(rs.length); // كلها مختلفة
    expect(times).toEqual([...expectedTimes].sort()); // بالضبط أول الأوقات الشاغرة المتتالية — لا ثغرات ولا قفز
    for (const r of ok) {
      // داخل دوام الطبيب ومدته = مدة جلسته
      expect(toMin(r.data.startTime)).toBeGreaterThanOrEqual(toMin(doctor.start));
      expect(toMin(r.data.endTime)).toBeLessThanOrEqual(toMin(doctor.end));
      expect(toMin(r.data.endTime) - toMin(r.data.startTime)).toBe(DUR);
      // الصف المحفوظ هو نفسه الذي أُبلغ صاحبه به
      expect(byId.get(r.data.id)?.startTime).toBe(r.data.startTime);
      expect(byId.get(r.data.id)?.activeSlot).toBe(true);
    }
    expect(active).toHaveLength(rs.length + preExistingActive); // لا صفوف جزئية/يتيمة
    expect(await overlaps(doctor.id)).toBe(0); // لا تداخل مع أي موعد آخر (ولا مع المحجوز مسبقًا)
    // إشعار الطبيب: واحد لكل حجز ويحمل الوقت المحجوز فعليًا لا الوقت المطلوب
    expect(notifs).toHaveLength(ok.length);
    const timeOf = new Map(ok.map((r) => [r.data.id as string, r.data.startTime as string]));
    for (const n of notifs) expect(n.message).toContain(`الساعة ${timeOf.get(n.appointmentId!)}.`);
    return { ok, times };
  }

  it(`A) ${N} مريضًا مختلفًا × POST /api/booking لنفس الوقت → ${N} حجزًا في ${N} وقتًا مختلفًا، والأولوية لترتيب نجاح المعاملات`, async () => {
    const d = await mkDoctor("A");
    const date = dateStr(2);
    const before = slotAssign.slotAssignStats.p2002Retries;
    const out = await fireTogether(N, (i) => call("POST", "/api/booking", bookingBody(d.id, date, i), patients[i].token, i));
    const { ok } = await assertAllBooked("A_100_same_slot", d, date, out, gridFrom(REQ, N));
    // واحد فقط أخذ الوقت المطلوب، والبقية نُقلوا تلقائيًا، والرد يذكر الوقت المطلوب الأصلي
    expect(ok.filter((r) => r.data.startTime === REQ)).toHaveLength(1);
    expect(ok.filter((r) => r.data.shiftedFromRequested)).toHaveLength(N - 1);
    expect(ok.every((r) => r.data.requestedStartTime === REQ)).toBe(true);
    // صاحب كل موعد هو مريض جلسته (من التوكن)، و100 مريض مختلف = 100 موعد مختلف
    const rows = await db.appointment.findMany({ where: { doctorId: d.id }, select: { patientId: true, startTime: true, createdAt: true } });
    expect(new Set(rows.map((r) => r.patientId)).size).toBe(N);
    // الأولوية = ترتيب نجاح المعاملات في القاعدة: createdAt يُحسب داخل المعاملة بعد الحصول على القفل، فلا يوجد
    // موعد أُنشئ قبل آخر (بفارق زمني فعلي) وأخذ وقتًا بعده.
    const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let inversions = 0;
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++)
        if (sorted[j].createdAt.getTime() > sorted[i].createdAt.getTime() && toMin(sorted[j].startTime) < toMin(sorted[i].startTime)) inversions++;
    (report.A_100_same_slot as any).priorityInversions = inversions;
    (report.A_100_same_slot as any).p2002RetriesDuringRun = slotAssign.slotAssignStats.p2002Retries - before;
    expect(inversions).toBe(0);
  });

  it("B) 50 مريضًا على 08:00 و50 على 08:30 (نصفهم عبر POST /api/appointments) → 100 حجز، لا أحد قبل وقته المطلوب", async () => {
    const d = await mkDoctor("B");
    const date = dateStr(3);
    const reqOf = (i: number) => (i < 50 ? "08:00" : "08:30");
    const out = await fireTogether(N, (i) =>
      i % 2 === 0
        ? call("POST", "/api/booking", bookingBody(d.id, date, i, reqOf(i)), patients[i].token, i)
        : call("POST", "/api/appointments", { doctorId: d.id, date, startTime: reqOf(i) }, patients[i].token, i)
    );
    await assertAllBooked("B_50_and_50", d, date, out, gridFrom("08:00", N));
    for (let i = 0; i < N; i++) {
      expect(toMin(out.rs[i].data.startTime)).toBeGreaterThanOrEqual(toMin(reqOf(i)));
      expect(out.rs[i].data.requestedStartTime).toBe(reqOf(i));
    }
    // 08:00 أخذه أحد من طلبه بالضبط (لا أحد من مجموعة 08:30 يأخذ وقتًا قبل 08:30)
    expect(out.rs.filter((r) => r.data.startTime === "08:00" && r.data.requestedStartTime === "08:00")).toHaveLength(1);
  });

  it("C) مواعيد محجوزة مسبقًا (CONFIRMED / COMPLETED / NO_SHOW / IN_PROGRESS) بين الأوقات → تُتخطّى ولا تُمسّ", async () => {
    const d = await mkDoctor("C");
    const date = dateStr(4);
    const taken = [["08:10", "CONFIRMED"], ["08:25", "COMPLETED"], ["08:40", "NO_SHOW"], ["09:00", "IN_PROGRESS"]] as const;
    const pre = [];
    for (const [t, status] of taken)
      pre.push(await db.appointment.create({ data: { doctorId: d.id, date: dateObj(date), startTime: t, endTime: toHHMM(toMin(t) + DUR), status, guestFirstName: "سابق", guestLastName: t } }));
    const out = await fireTogether(N, (i) => call("POST", "/api/booking", bookingBody(d.id, date, i), patients[i].token, i));
    const { times } = await assertAllBooked("C_preexisting_between", d, date, out, gridFrom(REQ, N, taken.map((x) => x[0])), taken.length);
    for (const [t] of taken) expect(times).not.toContain(t);
    for (const p of pre) expect(await db.appointment.findUnique({ where: { id: p.id } })).toEqual(p);
  });

  it("F) أوقات CANCELLED بين الأوقات → تُعاد استعمالها، والسجلات الملغاة محفوظة كما هي", async () => {
    const d = await mkDoctor("F");
    const date = dateStr(5);
    const cancelledTimes = ["08:00", "08:05", "08:15"];
    const pre = [];
    for (const t of cancelledTimes)
      pre.push(await db.appointment.create({ data: { doctorId: d.id, date: dateObj(date), startTime: t, endTime: toHHMM(toMin(t) + DUR), status: "CANCELLED", guestFirstName: "ملغى", guestLastName: t } }));
    for (const p of pre) expect(p.activeSlot).toBeNull();
    const out = await fireTogether(N, (i) => call("POST", "/api/booking", bookingBody(d.id, date, i), patients[i].token, i));
    const { times } = await assertAllBooked("F_cancelled_reused", d, date, out, gridFrom(REQ, N));
    for (const t of cancelledTimes) expect(times).toContain(t);
    for (const p of pre) expect(await db.appointment.findUnique({ where: { id: p.id } })).toEqual(p);
  });

  it("G) يوم ممتلئ: 30 طلبًا على طبيب بـ12 وقتًا فقط → 12 حجزًا داخل الدوام و18 رفضًا 409، بلا حلقة ولا موعد غير صالح", async () => {
    const d = await mkDoctor("G", "10:00", "11:00"); // 12 وقتًا × 5 دقائق
    const date = dateStr(6);
    const out = await fireTogether(30, (i) => call("POST", "/api/booking", bookingBody(d.id, date, i, "10:00"), patients[i].token, i));
    const ok = out.rs.filter((r) => r.status === 201);
    const rejected = out.rs.filter((r) => r.status === 409);
    report.G_full_day = { attempts: 30, statuses: summarize(out.rs), succeeded: ok.length, failed: rejected.length, totalMs: Math.round(out.totalMs), messages: [...new Set(rejected.map((r) => r.message))] };
    expect(out.rs.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(ok).toHaveLength(12);
    expect(rejected).toHaveLength(18);
    expect(new Set(rejected.map((r) => r.message))).toEqual(new Set(["هذا الوقت لم يعد متاحًا لدى هذا الطبيب. الرجاء اختيار وقت آخر."]));
    expect(ok.map((r) => r.data.startTime).sort()).toEqual(gridFrom("10:00", 12));
    const rows = await db.appointment.findMany({ where: { doctorId: d.id } });
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.date.toISOString().slice(0, 10)).toBe(date); // لا انتقال إلى يوم آخر
      expect(toMin(r.endTime)).toBeLessThanOrEqual(toMin("11:00")); // لا تجاوز لنهاية الدوام
    }
    expect(out.totalMs).toBeLessThan(20000);
    // طلب إضافي على يوم ممتلئ يُرفض فورًا بنفس الرسالة، وعبر المسار الآخر برسالته الحالية
    expect((await call("POST", "/api/booking", bookingBody(d.id, date, 99, "10:00"), patients[99].token, 99)).status).toBe(409);
    const alt = await call("POST", "/api/appointments", { doctorId: d.id, date, startTime: "10:30" }, patients[98].token, 98);
    expect(alt.status).toBe(409);
    expect(alt.message).toBe("هذه الفترة محجوزة مسبقًا أو غير متاحة. الرجاء اختيار فترة أخرى.");
    // وقت خارج الدوام ما زال يُرفض 400 كما كان (لا يُنقل إلى وقت آخر)
    expect((await call("POST", "/api/booking", bookingBody(d.id, date, 97, "11:30"), patients[97].token, 97)).status).toBe(400);
    expect(await db.appointment.count({ where: { doctorId: d.id } })).toBe(12);
  });

  it(`H) سباق أثناء اختيار الوقت البديل: ${N} طلب HTTP + 60 إدراجًا مباشرًا خارج القفل على الأوقات التالية → كل HTTP ينجح بلا تكرار`, async () => {
    const d = await mkDoctor("H", "06:00", "23:55");
    const date = dateStr(7);
    const before = slotAssign.slotAssignStats.p2002Retries;
    // أوقات بديلة يحاول كاتب «خارجي» (بلا قفل، مباشرة في القاعدة) أخذها بالتزامن مع الطلبات.
    const contested = gridFrom("08:05", 60);
    const out = await fireTogether(N + contested.length, (i): Promise<Res> => {
      if (i < N) return call("POST", "/api/booking", bookingBody(d.id, date, i), patients[i].token, i);
      const t = contested[i - N];
      return db.appointment
        .create({ data: { doctorId: d.id, date: dateObj(date), startTime: t, endTime: toHHMM(toMin(t) + DUR), status: "CONFIRMED", guestFirstName: "خارجي", guestLastName: t } })
        .then(() => ({ status: 1001, data: { startTime: t } }))
        .catch((e) => ({ status: e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" ? 1002 : 1003, data: null, message: String(e) }));
    });
    const httpRs = out.rs.slice(0, N);
    const direct = out.rs.slice(N);
    const retries = slotAssign.slotAssignStats.p2002Retries - before;
    const active = await db.appointment.findMany({ where: { doctorId: d.id, status: { not: "CANCELLED" } }, select: { startTime: true } });
    report.H_race_on_alternative = {
      httpAttempts: N, httpStatuses: summarize(httpRs), directInserts: direct.length,
      directWon: direct.filter((r) => r.status === 1001).length, directLostP2002: direct.filter((r) => r.status === 1002).length,
      p2002RetriesInBookingPath: retries, activeRows: active.length, distinctActiveStartTimes: new Set(active.map((a) => a.startTime)).size,
    };
    expect(httpRs.every((r) => r.status === 201)).toBe(true);
    expect(direct.filter((r) => r.status === 1003)).toHaveLength(0); // الخاسر المباشر يخسر بالقيد الفريد فقط
    expect(new Set(active.map((a) => a.startTime)).size).toBe(active.length); // 0 تكرار
    expect(active.length).toBe(N + direct.filter((r) => r.status === 1001).length);
    expect(await overlaps(d.id)).toBe(0);
    for (const r of httpRs) expect(toMin(r.data.startTime)).toBeGreaterThanOrEqual(toMin(REQ));
  });

  it(`D) ${N} إدراجًا مباشرًا متزامنًا في القاعدة (بلا منطق التطبيق) → صف نشط واحد والباقي P2002 — القيد الفريد ما زال فعّالًا`, async () => {
    const d = await mkDoctor("D");
    const date = dateObj(dateStr(8));
    // تسخين مجمّع اتصالات عميل الاختبار حتى لا يتزامن فتح 30 اتصالًا جديدًا مع السباق نفسه.
    await Promise.all(Array.from({ length: 30 }, () => db.$queryRaw`SELECT 1`));
    // أخطاء الاتصال (P1001/P2037/P2024) قيد بيئة Postgres المحلية على Windows وليست نتيجة للسباق:
    // تُعاد المحاولة نفسها فقط، فيبقى الشرط الصارم أن كل محاولة خاسرة رُفضت بالقيد الفريد (P2002).
    const CONN_ERRORS = new Set(["P1001", "P2037", "P2024"]);
    let connRetries = 0;
    const insert = async (i: number): Promise<string> => {
      for (let k = 0; ; k++) {
        try {
          await db.appointment.create({ data: { doctorId: d.id, patientId: patients[i].patientId, date, startTime: REQ, endTime: "08:05", status: "CONFIRMED" } });
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
    const date = dateObj(dateStr(9));
    const cancelledIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const a = await db.appointment.create({
        data: { doctorId: d.id, patientId: patients[i].patientId, date, startTime: REQ, endTime: "08:05", status: "CANCELLED" },
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

  it("اتساق عام: لا تكرار نشط في أي مكان، activeSlot مطابق للحالة، لا معاملات معلّقة، والقيد الفريد موجود", async () => {
    const dup = await globalDuplicates();
    const bad = await inconsistentActiveSlot();
    const idle = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE state = 'idle in transaction'`;
    report.global = { duplicateActiveSlots: dup, inconsistentActiveSlotRows: bad, idleInTransaction: Number(idle[0].n), uniqueConstraintPresent: await uniqueConstraintPresent() };
    expect(dup).toBe(0);
    expect(bad).toBe(0);
    expect(Number(idle[0].n)).toBe(0);
    expect(await uniqueConstraintPresent()).toBe(true);
  });
});
