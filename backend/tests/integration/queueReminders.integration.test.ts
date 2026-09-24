/**
 * تذكير «قبل 5 دقائق» المشروط بالطابور + تنبيه «دورك اقترب» — على PostgreSQL حقيقي.
 * كل ما عدا خدمة الدفع (web-push) حقيقي: Prisma، القيود الفريدة، الحجز الذرّي، منطق الطابور (queueOrder)،
 * المدة الذكية (estimateSessionMinutes). كل اختبار بطبيب مستقل، ويوم ثابت في المستقبل.
 *
 * تشغيل: TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54330/medbook_feature_test?schema=public" npx vitest run queueReminders
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const h = vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.REMINDERS_ENABLED = "false";
  return { sendNotification: vi.fn(async (..._args: any[]) => ({ statusCode: 201 })) };
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: h.sendNotification } }));

const TEST_URL = process.env.TEST_DATABASE_URL;
function assertSafeTestDb(url: string) {
  const u = new URL(url);
  const okHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!okHost || !/test/i.test(u.pathname)) throw new Error("رُفض التشغيل: قاعدة الاختبار يجب أن تكون محلية واسمها يحتوي test.");
}

const MIN = 60_000;
const DAY = new Date("2031-03-11T00:00:00Z"); // يوم ثابت (بتوقيت الجزائر) لا علاقة له بساعة الجهاز
const PAST_DAY = new Date("2031-03-10T00:00:00Z");
const at = (hhmm: string, plusMin = 0) => {
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2031, 2, 11, hh, mm) - 60 * MIN + plusMin * MIN); // الجزائر = UTC+1
};
const hhmm = (minOfDay: number) => `${String(Math.floor(minOfDay / 60)).padStart(2, "0")}:${String(minOfDay % 60).padStart(2, "0")}`;

type Payload = { title: string; kind?: string; appointmentId?: string };
const sent = (): { payload: Payload; options: any }[] =>
  h.sendNotification.mock.calls.map((c: any[]) => ({ payload: JSON.parse(c[1]), options: c[2] }));
const sentFor = (apptId: string) => sent().filter((s) => s.payload.appointmentId === apptId);

describe.skipIf(!TEST_URL)("تذكير الخمس دقائق المشروط بالطابور + «دورك اقترب» (PostgreSQL حقيقي)", () => {
  let db: PrismaClient;
  let reminders: typeof import("../../src/modules/reminders/reminders.service");
  const tag = `qr${Date.now().toString(36)}`;
  const created = { users: [] as string[], doctors: [] as string[], wilaya: "", city: "", specialty: "" };
  let seq = 0;

  async function newDoctor(opts: { closing?: string; smartMinutes?: number } = {}) {
    const n = ++seq;
    const u = await db.user.create({ data: { email: `${tag}-d${n}@test.local`, passwordHash: "x", role: "DOCTOR" } });
    created.users.push(u.id);
    const d = await db.doctor.create({
      data: {
        userId: u.id, firstName: "أحمد", lastName: "بن علي", specialtyId: created.specialty, wilayaId: created.wilaya, cityId: created.city,
        slotDurationMin: 10, verificationStatus: "VERIFIED", subscriptionStatus: "ACTIVE",
        schedules: { create: Array.from({ length: 7 }, (_, day) => ({ dayOfWeek: day, startTime: "00:00", endTime: opts.closing ?? "23:59" })) },
      },
    });
    created.doctors.push(d.id);
    // المدة الذكية: 3 جلسات مكتملة حقيقية في يوم سابق → estimateSessionMinutes = smartMinutes.
    if (opts.smartMinutes) {
      for (let i = 0; i < 3; i++) {
        await db.appointment.create({
          data: {
            doctorId: d.id, date: PAST_DAY, startTime: hhmm(600 + i * 10), endTime: hhmm(610 + i * 10), status: "COMPLETED",
            durationMinutes: opts.smartMinutes, endedAt: new Date(PAST_DAY.getTime() + (10 + i) * 60 * MIN),
          },
        });
      }
    }
    return d.id;
  }

  async function newPatient(devices = 1) {
    const n = ++seq;
    const u = await db.user.create({ data: { email: `${tag}-p${n}@test.local`, passwordHash: "x", role: "PATIENT" } });
    created.users.push(u.id);
    const p = await db.patient.create({ data: { userId: u.id, firstName: "مريض", lastName: `${n}` } });
    for (let i = 0; i < devices; i++) {
      await db.pushSubscription.create({
        data: { userId: u.id, endpoint: `https://fcm.googleapis.com/fcm/send/${tag}-${n}-${i}`, p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u", auth: "tBHItJI5svbpez7KI4CCXg" },
      });
    }
    return p.id;
  }

  async function appt(doctorId: string, startTime: string, data: Record<string, unknown> = {}) {
    const [hh, mm] = startTime.split(":").map(Number);
    return db.appointment.create({
      data: { doctorId, date: DAY, startTime, endTime: hhmm(hh * 60 + mm + 10), status: "CONFIRMED", guestFirstName: "ض", ...data },
    });
  }

  const cycle = (now: Date) => reminders.runReminderCycle(now);
  const row = (appointmentId: string, type: string) =>
    db.appointmentReminder.findUnique({ where: { appointmentId_type: { appointmentId, type: type as any } } });

  beforeAll(async () => {
    assertSafeTestDb(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL;
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    const w = await db.wilaya.create({ data: { code: tag.slice(-6), nameAr: `ولاية ${tag}` } });
    const c = await db.city.create({ data: { nameAr: `مدينة ${tag}`, wilayaId: w.id } });
    const s = await db.specialty.create({ data: { nameAr: `تخصص ${tag}` } });
    Object.assign(created, { wilaya: w.id, city: c.id, specialty: s.id });
    reminders = await import("../../src/modules/reminders/reminders.service");
  });

  beforeEach(() => h.sendNotification.mockClear());

  afterAll(async () => {
    if (!db) return;
    await db.appointmentReminder.deleteMany({ where: { appointment: { doctorId: { in: created.doctors } } } });
    await db.appointment.deleteMany({ where: { doctorId: { in: created.doctors } } });
    await db.doctorSchedule.deleteMany({ where: { doctorId: { in: created.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: created.doctors } } });
    await db.pushSubscription.deleteMany({ where: { userId: { in: created.users } } });
    await db.patient.deleteMany({ where: { userId: { in: created.users } } });
    await db.user.deleteMany({ where: { id: { in: created.users } } });
    await db.specialty.deleteMany({ where: { id: created.specialty } });
    await db.city.deleteMany({ where: { id: created.city } });
    await db.wilaya.deleteMany({ where: { id: created.wilaya } });
    await db.$disconnect();
  });

  // ================= تذكير قبل 5 دقائق =================

  it("1+11+12) موعد فعّال في الطابور: تذكير الساعة كما كان، ثم «موعدك مع الطبيب بعد 5 دقائق» بنمط المنبّه", async () => {
    const d = await newDoctor();
    const a = await appt(d, "16:00", { patientId: await newPatient() });
    await cycle(at("14:30"));
    await cycle(at("15:00"));
    await cycle(at("15:55"));
    const list = sentFor(a.id);
    expect(list.map((s) => s.payload.title)).toEqual(["🔔 تذكير بموعدك", "موعدك مع الطبيب بعد 5 دقائق"]);
    // الرنة الخاصة: نوع المنبّه + أولوية عالية للخمس دقائق فقط؛ تذكير الساعة بلا أي نوع خاص.
    expect(list[0].payload.kind).toBeUndefined();
    expect(list[0].options.urgency).toBeUndefined();
    expect(list[1].payload.kind).toBe("APPOINTMENT_5MIN_ALARM");
    expect(list[1].options.urgency).toBe("high");
    expect((await row(a.id, "FIVE_MINUTES"))!.status).toBe("SENT");
  });

  it("2) موعد ليس في الطابور (PENDING غير مؤكد، أو بعد إغلاق دوام الطبيب) → لا تذكير خمس دقائق", async () => {
    const d1 = await newDoctor();
    const pending = await appt(d1, "16:00", { patientId: await newPatient(), status: "PENDING" });
    const d2 = await newDoctor({ closing: "12:00" }); // الدوام انتهى قبل 15:55 → الطابور مغلق
    const afterClose = await appt(d2, "16:00", { patientId: await newPatient() });
    await cycle(at("15:00", -1));
    await cycle(at("15:55"));
    expect(sentFor(pending.id).filter((s) => s.payload.kind)).toHaveLength(0);
    expect(sentFor(afterClose.id).filter((s) => s.payload.kind)).toHaveLength(0);
    expect((await row(pending.id, "FIVE_MINUTES"))!.skipReason).toBe("status_PENDING");
    expect((await row(afterClose.id, "FIVE_MINUTES"))!.skipReason).toBe("not_in_queue");
  });

  it.each(["CANCELLED", "COMPLETED", "NO_SHOW"])("3-5) موعد أصبح %s قبل 15:55 → لا إرسال", async (status) => {
    const d = await newDoctor();
    const a = await appt(d, "16:00", { patientId: await newPatient() });
    await cycle(at("14:30"));
    await db.appointment.update({ where: { id: a.id }, data: { status: status as any, ...(status === "CANCELLED" ? { activeSlot: null } : {}) } });
    await cycle(at("15:00"));
    await cycle(at("15:55"));
    expect(sentFor(a.id)).toHaveLength(0);
    expect((await row(a.id, "FIVE_MINUTES"))!.status).toBe("SKIPPED");
  });

  it("6) تغيّر وقت الموعد: لا تذكير على الوقت القديم، والتذكير يتبع الوقت الحالي (للأمام وللخلف)", async () => {
    const d = await newDoctor();
    const later = await appt(d, "16:00", { patientId: await newPatient() });
    const earlier = await appt(d, "17:00", { patientId: await newPatient() });
    await cycle(at("14:30")); // سجلات على 15:55 و 16:55
    await db.appointment.update({ where: { id: later.id }, data: { startTime: "16:30", endTime: "16:40" } });
    await db.appointment.update({ where: { id: earlier.id }, data: { startTime: "15:30", endTime: "15:40" } });
    await cycle(at("15:25"));
    expect(sentFor(earlier.id).filter((s) => s.payload.kind === "APPOINTMENT_5MIN_ALARM")).toHaveLength(1);
    await cycle(at("15:55"));
    expect(sentFor(later.id).filter((s) => s.payload.kind === "APPOINTMENT_5MIN_ALARM")).toHaveLength(0);
    await cycle(at("16:25"));
    expect(sentFor(later.id).filter((s) => s.payload.kind === "APPOINTMENT_5MIN_ALARM")).toHaveLength(1);
    expect((await row(later.id, "FIVE_MINUTES"))!.scheduledFor.toISOString()).toBe(at("16:25").toISOString());
  });

  it("7) موعد LATE أُعيد إلى الخلف في الطابور: ما زال داخل الطابور → يبقى مؤهلًا ويصله التذكير", async () => {
    const d = await newDoctor();
    const p = await newPatient();
    await appt(d, "15:40");
    await appt(d, "15:50");
    const a = await appt(d, "16:00", { patientId: p });
    await cycle(at("15:00", -1));
    await db.appointment.update({ where: { id: a.id }, data: { status: "LATE", skipCredits: 2, deferredCount: 1 } });
    await cycle(at("15:55"));
    expect(sentFor(a.id).filter((s) => s.payload.kind === "APPOINTMENT_5MIN_ALARM")).toHaveLength(1);
  });

  it("8+9+10) لا تكرار: تشغيل متكرر، دورات متزامنة، وإعادة تحميل الخدمة (إعادة تشغيل) → إشعار واحد", async () => {
    const d = await newDoctor();
    const a = await appt(d, "16:00", { patientId: await newPatient(2) });
    await cycle(at("15:00", -1));
    const stats = () => ({ created: 0, sent: 0, skipped: 0, failed: 0 });
    await Promise.all([
      cycle(at("15:55")),
      reminders.processDueReminders(at("15:55"), stats()),
      reminders.processDueReminders(at("15:55"), stats()),
      reminders.processDueReminders(at("15:56"), stats()),
    ]);
    await cycle(at("15:57"));
    vi.resetModules(); // «إعادة تشغيل الخادم»: وحدة جديدة بلا أي حالة في الذاكرة
    const fresh = await import("../../src/modules/reminders/reminders.service");
    await fresh.runReminderCycle(at("15:58"));
    await fresh.runReminderCycle(at("15:58"));
    const five = sentFor(a.id).filter((s) => s.payload.kind === "APPOINTMENT_5MIN_ALARM");
    expect(five).toHaveLength(2); // جهازان × إشعار واحد
    expect(await db.appointmentReminder.count({ where: { appointmentId: a.id, type: "FIVE_MINUTES" } })).toBe(1);
  });

  it("13) إشعارات MadBook الأخرى بلا تغيير: لا نوع خاص ولا أولوية ولا خيارات إضافية", async () => {
    const p = await db.patient.findUniqueOrThrow({ where: { id: await newPatient() } });
    const { sendPushToUser } = await import("../../src/lib/push");
    await sendPushToUser(p.userId, { title: "إشعار عام", body: "نص" });
    const call = h.sendNotification.mock.calls[0] as any[];
    expect(call).toHaveLength(2); // (اشتراك، حمولة) كما كان — بلا TTL ولا urgency
    expect(JSON.parse(call[1]).kind).toBeUndefined();
  });

  // ================= «دورك اقترب» =================

  it("المثال الواقعي: A بالداخل، B قبله، C موعده بعد 20 دقيقة لكن دوره متوقع خلال دقائق → «دورك اقترب»", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    await appt(d, "15:30", { status: "IN_PROGRESS", calledAt: at("15:39") }); // A
    await appt(d, "15:45"); // B
    const c = await appt(d, "16:00", { patientId: await newPatient() }); // C
    // 15:40: ما تبقى لـA ≈ 4 د + B 5 د = 9 د ≤ 10 → تنبيه، رغم أن موعد C بعد 20 دقيقة.
    const s = await cycle(at("15:40"));
    expect(s.queueApproachSent).toBe(1);
    const got = sentFor(c.id);
    expect(got).toHaveLength(1);
    expect(got[0].payload).toMatchObject({ title: "دورك اقترب", kind: "QUEUE_APPROACH_ALARM" });
    expect((got[0].payload as any).body).toBe("دورك اقترب، يرجى الاستعداد والتوجه إلى الطبيب.");
    expect(got[0].options.urgency).toBe("high");
  });

  it("المريض بعيد في الطابور → لا تنبيه (ولا يُرسل لمجرد عدد ثابت قبله)", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    await appt(d, "15:00", { status: "IN_PROGRESS", calledAt: at("15:39") });
    for (const t of ["15:10", "15:20", "15:30", "15:40"]) await appt(d, t);
    const c = await appt(d, "16:00", { patientId: await newPatient() }); // 4 منتظرين قبله → ~24 د
    await cycle(at("15:40"));
    expect(sentFor(c.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(0);
    expect(await row(c.id, "QUEUE_APPROACH")).toBeNull();
    // نفس العدد (مريض واحد قبله) لكن المدة الذكية طويلة → الوقت المتوقع بعيد → لا تنبيه.
    const d2 = await newDoctor({ smartMinutes: 30 });
    await appt(d2, "15:00", { status: "IN_PROGRESS", calledAt: at("15:39") });
    await appt(d2, "15:10");
    const c2 = await appt(d2, "16:00", { patientId: await newPatient() });
    await cycle(at("15:40"));
    expect(sentFor(c2.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(0);
  });

  it("العيادة لم تبدأ بعد (لا أحد بالداخل ولا مناداة حديثة) → لا تنبيه حتى لو كان أول الطابور", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    const c = await appt(d, "16:00", { patientId: await newPatient() });
    await cycle(at("15:30"));
    expect(sentFor(c.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(0);
  });

  it("تأخّر الطبيب: الوقت المتوقع يُعاد حسابه كل دورة من الطابور الفعلي، والتنبيه يصل حين يقترب الدور فعلًا", async () => {
    const d = await newDoctor(); // بلا عيّنات → المدة الذكية 20 د
    const A = await appt(d, "15:00", { status: "IN_PROGRESS", calledAt: at("15:00") });
    const B = await appt(d, "15:10");
    const c = await appt(d, "15:20", { patientId: await newPatient() });
    await cycle(at("15:01")); // A: 19 + B: 20 = 39 د
    await cycle(at("15:35")); // الطبيب تأخر مع A: 1 + 20 = 21 د (فات وقت C الأصلي)
    expect(sentFor(c.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(0);
    // A انتهى و B دخل على 15:40
    await db.appointment.update({ where: { id: A.id }, data: { status: "COMPLETED", endedAt: at("15:40"), durationMinutes: 40 } });
    await db.appointment.update({ where: { id: B.id }, data: { status: "IN_PROGRESS", calledAt: at("15:40") } });
    await cycle(at("15:45")); // 15 د
    expect(sentFor(c.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(0);
    await cycle(at("15:51")); // 9 د ≤ 10 → تنبيه
    expect(sentFor(c.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(1);
  });

  it("تغيّر ترتيب الطابور بسبب LATE يُعاد حسابه: المتأخر لا يُنبَّه على ترتيبه القديم، ويُنبَّه حين يعود دوره", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    const X = await appt(d, "15:00", { status: "IN_PROGRESS", calledAt: at("15:40") });
    const c = await appt(d, "15:10", { patientId: await newPatient(), status: "LATE", skipCredits: 4, deferredCount: 2 });
    const others = [await appt(d, "15:20"), await appt(d, "15:30"), await appt(d, "15:40"), await appt(d, "15:50")];
    await cycle(at("15:41")); // ترتيبه الأصلي أول الطابور، لكن بعد LATE يسبقه 4 → ~24 د
    expect(sentFor(c.id)).toHaveLength(0);
    // مُنادى 3 مرضى (الرصيد ينقص مع كل مناداة) → بقي قبله واحد
    await db.appointment.update({ where: { id: X.id }, data: { status: "COMPLETED" } });
    for (const o of others.slice(0, 2)) await db.appointment.update({ where: { id: o.id }, data: { status: "COMPLETED" } });
    await db.appointment.update({ where: { id: others[2].id }, data: { status: "IN_PROGRESS", calledAt: at("15:58") } });
    await db.appointment.update({ where: { id: c.id }, data: { skipCredits: 1 } });
    await cycle(at("15:59")); // بالداخل ~4 د + واحد قبله 5 د = 9 د
    expect(sentFor(c.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(1);
  });

  it("لا يُرسل «دورك اقترب» أكثر من مرة: دورات متكررة ومتزامنة وإعادة تحميل الخدمة", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    await appt(d, "15:30", { status: "IN_PROGRESS", calledAt: at("15:39") });
    const c = await appt(d, "15:45", { patientId: await newPatient() });
    const stats = () => ({ created: 0, sent: 0, skipped: 0, failed: 0 });
    await Promise.all([
      reminders.processQueueApproach(at("15:40"), stats()),
      reminders.processQueueApproach(at("15:40"), stats()),
      reminders.processQueueApproach(at("15:41"), stats()),
    ]);
    await cycle(at("15:42"));
    vi.resetModules();
    const fresh = await import("../../src/modules/reminders/reminders.service");
    await fresh.runReminderCycle(at("15:43"));
    expect(sentFor(c.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(1);
    expect(await db.appointmentReminder.count({ where: { appointmentId: c.id, type: "QUEUE_APPROACH" } })).toBe(1);
  });

  it("وصول المريض إلى IN_PROGRESS يوقف تنبيهات الانتظار (لا اقتراب ولا خمس دقائق)", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    const c = await appt(d, "16:00", { patientId: await newPatient(), status: "IN_PROGRESS", calledAt: at("15:50") });
    await cycle(at("15:00", -1));
    await cycle(at("15:52"));
    await cycle(at("15:55"));
    expect(sentFor(c.id).filter((s) => s.payload.kind)).toHaveLength(0);
    expect(await row(c.id, "QUEUE_APPROACH")).toBeNull();
    const five = await row(c.id, "FIVE_MINUTES"); // لا يُنشأ أصلًا لمن هو بالداخل، أو يُتخطّى إن أُنشئ قبل دخوله
    expect(five === null || five.status === "SKIPPED").toBe(true);
  });

  it.each(["CANCELLED", "COMPLETED", "NO_SHOW"])("موعد %s → لا تنبيه «دورك اقترب»", async (status) => {
    const d = await newDoctor({ smartMinutes: 5 });
    await appt(d, "15:30", { status: "IN_PROGRESS", calledAt: at("15:39") });
    const c = await appt(d, "15:45", {
      patientId: await newPatient(),
      status: status as any,
      ...(status === "CANCELLED" ? { activeSlot: null } : {}),
    });
    await cycle(at("15:40"));
    expect(sentFor(c.id)).toHaveLength(0);
  });

  it("تغيّر وقت الموعد الأصلي لا يستعمل بيانات قديمة: الحدّ الزمني يُقرأ من الوقت الحالي في قاعدة البيانات", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    await appt(d, "15:30", { status: "IN_PROGRESS", calledAt: at("15:39") });
    const c = await appt(d, "16:00", { patientId: await newPatient() });
    await db.appointment.update({ where: { id: c.id }, data: { startTime: "18:00", endTime: "18:10" } }); // أبعد من 90 د
    await cycle(at("15:40"));
    expect(sentFor(c.id)).toHaveLength(0);
    await db.appointment.update({ where: { id: c.id }, data: { startTime: "16:10", endTime: "16:20" } });
    await cycle(at("15:41"));
    expect(sentFor(c.id).filter((s) => s.payload.kind === "QUEUE_APPROACH_ALARM")).toHaveLength(1);
  });

  it("لا تكرار ولا تضارب: «دورك اقترب» ثم وقت الخمس دقائق → تذكير الخمس دقائق يُتخطّى", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    await appt(d, "15:40", { status: "IN_PROGRESS", calledAt: at("15:50") });
    const c = await appt(d, "16:00", { patientId: await newPatient() });
    await cycle(at("15:00", -1));
    await cycle(at("15:51")); // اقتراب: ~4 د
    await cycle(at("15:55"));
    await cycle(at("15:56"));
    const kinds = sentFor(c.id).map((s) => s.payload.kind).filter(Boolean);
    expect(kinds).toEqual(["QUEUE_APPROACH_ALARM"]);
    expect((await row(c.id, "FIVE_MINUTES"))!.skipReason).toBe("superseded_by_queue_approach");
  });

  it("لا تكرار ولا تضارب: الخمس دقائق أولًا → لا منبّه ثانٍ خلال 10 دقائق، ثم «دورك اقترب» إن تأخر الطابور", async () => {
    const d = await newDoctor({ smartMinutes: 5 });
    const A = await appt(d, "15:40", { status: "IN_PROGRESS", calledAt: at("15:54") });
    const B = await appt(d, "15:45");
    await appt(d, "15:50");
    const c = await appt(d, "16:00", { patientId: await newPatient() });
    await cycle(at("15:00", -1));
    await cycle(at("15:55")); // الطابور: A (~4 د) + اثنان × 5 = 14 د → لا اقتراب؛ الخمس دقائق يُرسل
    expect(sentFor(c.id).map((s) => s.payload.kind).filter(Boolean)).toEqual(["APPOINTMENT_5MIN_ALARM"]);
    await db.appointment.update({ where: { id: A.id }, data: { status: "COMPLETED", endedAt: at("16:02") } });
    await db.appointment.update({ where: { id: B.id }, data: { status: "IN_PROGRESS", calledAt: at("16:02") } });
    await cycle(at("16:04")); // دوره بعد ~8 د لكن الخمس دقائق قبل 9 د فقط → لا منبّه ثانٍ الآن
    expect(sentFor(c.id).map((s) => s.payload.kind).filter(Boolean)).toEqual(["APPOINTMENT_5MIN_ALARM"]);
    await cycle(at("16:06")); // بعد 11 د، ودوره بعد ~6 د → «دورك اقترب» مرة واحدة
    await cycle(at("16:07"));
    expect(sentFor(c.id).map((s) => s.payload.kind).filter(Boolean)).toEqual(["APPOINTMENT_5MIN_ALARM", "QUEUE_APPROACH_ALARM"]);
  });
});
