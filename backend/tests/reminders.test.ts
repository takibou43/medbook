/**
 * نظام تذكيرات المواعيد (قبل ساعة + قبل 5 دقائق) — منطق الكود الحقيقي (reminders.service.ts)
 * مع استبدال Prisma بمخزن في الذاكرة يطبّق نفس القيود المهمة: القيد الفريد (appointmentId, type)
 * عبر skipDuplicates، والحجز الذرّي عبر updateMany المشروط. وخدمة Push مستبدلة بدالة مراقَبة.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  type Appt = { id: string; status: string; date: Date; startTime: string; patientUserId: string | null; patientId: string | null; doctorId: string };
  type Rem = { id: string; appointmentId: string; type: string; scheduledFor: Date; status: string; sentAt?: Date; deliveredCount?: number; skipReason?: string };
  const state = { appts: [] as Appt[], reminders: [] as Rem[], devices: new Map<string, number>(), seq: 0 };

  // مطابقة مبسّطة لشروط Prisma المستعملة في reminders.service: مساواة، in، not، gte/lte (للتواريخ).
  const val = (v: any) => (v instanceof Date ? v.getTime() : v);
  const match = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, cond]: [string, any]) => {
      const v = row[k];
      if (cond instanceof Date || cond === null || typeof cond !== "object") return val(v) === val(cond);
      if ("in" in cond && !cond.in.map(val).includes(val(v))) return false;
      if ("not" in cond && val(v) === val(cond.not)) return false;
      if ("gte" in cond && !(val(v) >= val(cond.gte))) return false;
      if ("lte" in cond && !(val(v) <= val(cond.lte))) return false;
      return true;
    });
  const pick = (r: any, select?: any) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : r);
  const findRem = (where: any) =>
    where.appointmentId_type
      ? state.reminders.find((x) => x.appointmentId === where.appointmentId_type.appointmentId && x.type === where.appointmentId_type.type)
      : state.reminders.find((x) => x.id === where.id);

  const db = {
    appointment: {
      findMany: async ({ where, select }: any) => state.appts.filter((a) => match(a, where)).map((a) => pick(a, select)),
      findUnique: async ({ where }: any) => {
        const a = state.appts.find((x) => x.id === where.id);
        return a ? { ...a, patient: a.patientUserId ? { userId: a.patientUserId } : null } : null;
      },
    },
    appointmentReminder: {
      createMany: async ({ data, skipDuplicates }: any) => {
        let count = 0;
        for (const row of data) {
          const dup = state.reminders.some((r) => r.appointmentId === row.appointmentId && r.type === row.type);
          if (dup) {
            if (!skipDuplicates) throw new Error("P2002");
            continue;
          }
          state.reminders.push({ id: `r${++state.seq}`, status: "PENDING", ...row });
          count += 1;
        }
        return { count };
      },
      findMany: async ({ where, take, select }: any) =>
        state.reminders
          .filter((r) => match(r, where))
          .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
          .slice(0, take ?? Infinity)
          .map((r) => pick(r, select)),
      // الحجز الذرّي: يغيّر السجلات المطابقة للشرط فقط (ومنه الحالة الحالية).
      updateMany: async ({ where, data }: any) => {
        const rows = state.reminders.filter((x) => match(x, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      findUnique: async ({ where }: any) => {
        const r = findRem(where);
        if (!r) return null;
        if (where.appointmentId_type) return r;
        const a = state.appts.find((x) => x.id === r.appointmentId);
        return {
          id: r.id,
          type: r.type,
          appointment: a
            ? {
                id: a.id,
                status: a.status,
                date: a.date,
                startTime: a.startTime,
                doctorId: a.doctorId,
                patient: a.patientUserId ? { userId: a.patientUserId } : null,
                doctor: { firstName: "أحمد", lastName: "بن علي" },
              }
            : null,
        };
      },
      update: async ({ where, data }: any) => {
        const r = state.reminders.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    pushSubscription: {
      count: async ({ where }: any) => state.devices.get(where.userId) ?? 0,
    },
  };

  const sendPushToUser = vi.fn(async (userId: string, _payload: any, _opts?: any) => ({ sent: state.devices.get(userId) ?? 0, removed: 0 }));
  return { state, db, sendPushToUser };
});

vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
// طابور اليوم في هذا الملف: كل مواعيد الطبيب CONFIRMED/LATE في يوم now (العيادة لم تبدأ المناداة بعد).
// منطق الطابور الحقيقي على PostgreSQL مختبر في tests/integration/queueReminders.integration.test.ts.
vi.mock("../src/lib/doctorQueue", async (importOriginal) => {
  const real: any = await importOriginal();
  return {
    ...real,
    loadDoctorDayQueue: async (_db: unknown, doctorId: string, now: Date) => {
      const day = real.algeriaDayStart(now);
      return {
        day,
        closed: false,
        lastActivityAt: null,
        rows: h.state.appts
          .filter((a) => a.doctorId === doctorId && a.date.getTime() === day.getTime() && ["CONFIRMED", "LATE", "IN_PROGRESS"].includes(a.status))
          .map((a) => ({ id: a.id, startTime: a.startTime, status: a.status, skipCredits: 0, calledAt: null })),
      };
    },
  };
});
vi.mock("../src/modules/appointments/appointments.service", () => ({ estimateSessionMinutes: async () => 20 }));
vi.mock("../src/lib/push", () => ({ sendPushToUser: h.sendPushToUser, isPushEnabled: () => true }));

import {
  runReminderCycle,
  processDueReminders,
  evaluateReminder,
  appointmentStartUtc,
  buildReminderPayload,
} from "../src/modules/reminders/reminders.service";

const MIN = 60 * 1000;
const PATIENT_USER = "user-patient-1";

/** موعد يبدأ في لحظة UTC معيّنة — يحوّلها إلى (يوم الجزائر + HH:mm بتوقيت الجزائر) كما يخزّنها النظام. */
function addAppt(id: string, startUtc: Date, opts: { status?: string; guest?: boolean } = {}) {
  const local = new Date(startUtc.getTime() + 60 * MIN);
  const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const startTime = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  h.state.appts.push({
    id,
    status: opts.status ?? "CONFIRMED",
    date,
    startTime,
    patientUserId: opts.guest ? null : PATIENT_USER,
    patientId: opts.guest ? null : "patient-1",
    doctorId: "doc-1",
  });
  return h.state.appts[h.state.appts.length - 1];
}

const setStatus = (id: string, status: string) => {
  h.state.appts.find((a) => a.id === id)!.status = status;
};
const reminder = (apptId: string, type: string) => h.state.reminders.find((r) => r.appointmentId === apptId && r.type === type);
const sentTitles = () => h.sendPushToUser.mock.calls.map((c) => (c[1] as any).title);

// موعد مثال من المواصفة: 2026-10-01 10:00 بتوقيت الجزائر = 09:00 UTC.
const START = new Date("2026-10-01T09:00:00Z");

beforeEach(() => {
  h.state.appts = [];
  h.state.reminders = [];
  h.state.devices = new Map([[PATIENT_USER, 1]]);
  h.sendPushToUser.mockClear();
});

describe("التوقيت (دالة نقية)", () => {
  it("2026-10-01 10:00 بتوقيت الجزائر = 09:00 UTC، والتذكيران على 09:00 و09:55 بتوقيت الجزائر", () => {
    const start = appointmentStartUtc(new Date("2026-10-01T00:00:00Z"), "10:00");
    expect(start.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(evaluateReminder("ONE_HOUR" as any, start, new Date("2026-10-01T07:59:59Z"))).toBe("NOT_YET");
    expect(evaluateReminder("ONE_HOUR" as any, start, new Date("2026-10-01T08:00:00Z"))).toBe("DUE"); // 09:00 محليًا
    expect(evaluateReminder("FIVE_MINUTES" as any, start, new Date("2026-10-01T08:54:59Z"))).toBe("NOT_YET");
    expect(evaluateReminder("FIVE_MINUTES" as any, start, new Date("2026-10-01T08:55:00Z"))).toBe("DUE"); // 09:55 محليًا
  });

  it("بعد بدء الموعد: لا تذكير (EXPIRED)، وتذكير الساعة المتأخر داخل نافذة الخمس دقائق يُستبدل (SUPERSEDED)", () => {
    expect(evaluateReminder("FIVE_MINUTES" as any, START, START)).toBe("EXPIRED");
    expect(evaluateReminder("ONE_HOUR" as any, START, new Date(START.getTime() + MIN))).toBe("EXPIRED");
    expect(evaluateReminder("ONE_HOUR" as any, START, new Date(START.getTime() - 3 * MIN))).toBe("SUPERSEDED");
  });

  it("لا يوجد أي تذكير 24 ساعة: قبل الموعد بيوم لا شيء مستحق", () => {
    const dayBefore = new Date(START.getTime() - 24 * 60 * MIN);
    expect(evaluateReminder("ONE_HOUR" as any, START, dayBefore)).toBe("NOT_YET");
    expect(evaluateReminder("FIVE_MINUTES" as any, START, dayBefore)).toBe("NOT_YET");
  });
});

describe("نص الإشعار", () => {
  const appt = { id: "a1", date: new Date("2026-10-01T00:00:00Z"), startTime: "10:00", doctor: { firstName: "أحمد", lastName: "بن علي" } };

  it("تذكير الساعة ثم الخمس دقائق بالنصوص المطلوبة، مع رابط صفحة المريض", () => {
    const one = buildReminderPayload("ONE_HOUR" as any, appt, new Date("2026-10-01T08:00:00Z"));
    expect(one.title).toBe("🔔 تذكير بموعدك");
    expect(one.body).toBe("لديك موعد مع د. أحمد بن علي اليوم على الساعة 10:00.");
    expect(one.url).toBe("/account?appointment=a1");
    const five = buildReminderPayload("FIVE_MINUTES" as any, appt, new Date("2026-10-01T08:55:00Z"));
    expect(five.title).toBe("موعدك مع الطبيب بعد 5 دقائق");
    expect(five.body).toBe("لديك موعد مع د. أحمد بن علي على الساعة 10:00.");
  });

  it("منتصف الليل: موعد 00:30 يُذكَّر به على 23:30 من اليوم السابق بكلمة \"غدًا\"", () => {
    const midnight = { ...appt, date: new Date("2026-10-02T00:00:00Z"), startTime: "00:30" };
    // 23:30 بتوقيت الجزائر يوم 10-01 = 22:30 UTC
    const p = buildReminderPayload("ONE_HOUR" as any, midnight, new Date("2026-10-01T22:30:00Z"));
    expect(p.body).toContain("غدًا على الساعة 00:30");
  });

  it("لا يحمل أي بيانات طبية (لا تخصص ولا ملاحظات ولا سبب زيارة)", () => {
    const p = buildReminderPayload("ONE_HOUR" as any, { ...appt, notes: "ألم في الصدر", specialty: "قلب" } as any, new Date("2026-10-01T08:00:00Z"));
    expect(JSON.stringify(p)).not.toMatch(/ألم|قلب|notes|specialty/);
  });
});

describe("دورة الـscheduler", () => {
  it("1) موعد بعد أكثر من ساعة: يُنشأ السجلان ولا يُرسل شيء مبكرًا", async () => {
    addAppt("a1", START);
    const s = await runReminderCycle(new Date(START.getTime() - 61 * MIN));
    expect(s.created).toBe(2);
    expect(h.sendPushToUser).not.toHaveBeenCalled();
    expect(reminder("a1", "ONE_HOUR")!.status).toBe("PENDING");
    expect(reminder("a1", "FIVE_MINUTES")!.status).toBe("PENDING");
  });

  it("2+3) قبل ساعة يُرسل ONE_HOUR، وقبل 5 دقائق يُرسل FIVE_MINUTES — مرة واحدة لكل منهما", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 61 * MIN));
    const r1 = await runReminderCycle(new Date(START.getTime() - 60 * MIN));
    expect(r1.sent).toBe(1);
    expect(sentTitles()).toEqual(["🔔 تذكير بموعدك"]);
    expect(reminder("a1", "ONE_HOUR")!.status).toBe("SENT");
    expect(reminder("a1", "ONE_HOUR")!.sentAt).toBeInstanceOf(Date);

    const r2 = await runReminderCycle(new Date(START.getTime() - 5 * MIN));
    expect(r2.sent).toBe(1);
    expect(sentTitles()).toEqual(["🔔 تذكير بموعدك", "موعدك مع الطبيب بعد 5 دقائق"]);
    expect(reminder("a1", "FIVE_MINUTES")!.status).toBe("SENT");
  });

  it("4+5+10) تشغيل الـscheduler مرات عديدة (متتالية ومتزامنة) لا يكرر أي إشعار", async () => {
    addAppt("a1", START);
    const t1 = new Date(START.getTime() - 59 * MIN);
    for (let i = 0; i < 5; i++) await runReminderCycle(t1);
    // متزامن: عدة معالِجات في نفس اللحظة (كأنها نسخ مختلفة من الخادم) على نفس السجلات
    await Promise.all(Array.from({ length: 5 }, () => processDueReminders(t1, { created: 0, sent: 0, skipped: 0, failed: 0 })));
    expect(h.sendPushToUser).toHaveBeenCalledTimes(1);

    const t2 = new Date(START.getTime() - 4 * MIN);
    for (let i = 0; i < 5; i++) await runReminderCycle(t2);
    await Promise.all(Array.from({ length: 5 }, () => processDueReminders(t2, { created: 0, sent: 0, skipped: 0, failed: 0 })));
    expect(h.sendPushToUser).toHaveBeenCalledTimes(2);
    expect(h.state.reminders.filter((r) => r.appointmentId === "a1")).toHaveLength(2);
  });

  it("6) إلغاء الموعد قبل وقت تذكير الساعة: لا يُرسل، ويُعلَّم SKIPPED", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 90 * MIN));
    setStatus("a1", "CANCELLED");
    await runReminderCycle(new Date(START.getTime() - 60 * MIN));
    await runReminderCycle(new Date(START.getTime() - 5 * MIN));
    expect(h.sendPushToUser).not.toHaveBeenCalled();
    expect(reminder("a1", "ONE_HOUR")).toMatchObject({ status: "SKIPPED", skipReason: "status_CANCELLED" });
    expect(reminder("a1", "FIVE_MINUTES")).toMatchObject({ status: "SKIPPED", skipReason: "status_CANCELLED" });
  });

  it("7+17) إلغاء بعد تذكير الساعة وقبل الخمس دقائق: الأول أُرسل، الثاني لا", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 60 * MIN));
    setStatus("a1", "CANCELLED");
    await runReminderCycle(new Date(START.getTime() - 5 * MIN));
    expect(sentTitles()).toEqual(["🔔 تذكير بموعدك"]);
    expect(reminder("a1", "FIVE_MINUTES")!.status).toBe("SKIPPED");
  });

  it.each(["COMPLETED", "NO_SHOW", "CANCELLED"])("8+9) موعد %s: لا تذكيرات مستقبلية (ولا تُنشأ له سجلات)", async (status) => {
    addAppt("a1", START, { status });
    const s1 = await runReminderCycle(new Date(START.getTime() - 60 * MIN));
    await runReminderCycle(new Date(START.getTime() - 5 * MIN));
    expect(s1.created).toBe(0);
    expect(h.sendPushToUser).not.toHaveBeenCalled();
  });

  it("تغيّر الحالة إلى COMPLETED/NO_SHOW بعد إنشاء السجل: الـscheduler يتحقق قبل الإرسال", async () => {
    addAppt("a1", START);
    addAppt("a2", new Date(START.getTime() + 30 * MIN));
    await runReminderCycle(new Date(START.getTime() - 61 * MIN));
    setStatus("a1", "COMPLETED");
    setStatus("a2", "NO_SHOW");
    await runReminderCycle(new Date(START.getTime() + 25 * MIN));
    expect(h.sendPushToUser).not.toHaveBeenCalled();
    expect(reminder("a2", "ONE_HOUR")!.skipReason).toBe("status_NO_SHOW");
  });

  it("حجز ضيف بلا حساب: لا سجلات تذكير ولا إشعارات (الحجز القديم لا يتأثر)", async () => {
    addAppt("g1", START, { guest: true });
    const s = await runReminderCycle(new Date(START.getTime() - 60 * MIN));
    expect(s.created).toBe(0);
    expect(h.state.reminders).toHaveLength(0);
  });

  it("موعد قريب جدًا (بعد 3 دقائق): تذكير الساعة يُستبدل ويُرسل تذكير الخمس دقائق وحده", async () => {
    const now = new Date(START.getTime() - 3 * MIN);
    addAppt("a1", START);
    await runReminderCycle(now);
    expect(sentTitles()).toEqual(["موعدك مع الطبيب بعد 5 دقائق"]);
    expect(reminder("a1", "ONE_HOUR")).toMatchObject({ status: "SKIPPED", skipReason: "superseded" });
  });

  it("الخادم كان نائمًا حتى بعد بداية الموعد: لا تذكير متأخر", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 61 * MIN));
    await runReminderCycle(new Date(START.getTime() + 2 * MIN));
    expect(h.sendPushToUser).not.toHaveBeenCalled();
    expect(reminder("a1", "ONE_HOUR")!.skipReason).toBe("expired");
  });

  it("مريض بلا أي جهاز مفعّل: SKIPPED(no_subscription) بلا محاولة إرسال", async () => {
    h.state.devices = new Map();
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 60 * MIN));
    expect(h.sendPushToUser).not.toHaveBeenCalled();
    expect(reminder("a1", "ONE_HOUR")).toMatchObject({ status: "SKIPPED", skipReason: "no_subscription" });
  });

  it("كل الأجهزة رفضت الإشعار: FAILED ولا إعادة إرسال لاحقًا", async () => {
    h.sendPushToUser.mockResolvedValueOnce({ sent: 0, removed: 1 });
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 60 * MIN));
    await runReminderCycle(new Date(START.getTime() - 59 * MIN));
    expect(h.sendPushToUser).toHaveBeenCalledTimes(1);
    expect(reminder("a1", "ONE_HOUR")!.status).toBe("FAILED");
  });

  it("منتصف الليل وتغيّر اليوم: موعد 00:30 يُنشأ ويُرسل تذكيره على 23:30 من اليوم السابق", async () => {
    const start = new Date("2026-10-01T23:30:00Z"); // 00:30 بتوقيت الجزائر يوم 10-02
    addAppt("m1", start);
    const now = new Date("2026-10-01T22:30:00Z"); // 23:30 بتوقيت الجزائر يوم 10-01
    const s = await runReminderCycle(now);
    expect(s.created).toBe(2);
    expect(s.sent).toBe(1);
    expect((h.sendPushToUser.mock.calls[0][1] as any).body).toContain("غدًا على الساعة 00:30");
  });
});

describe("تنبيه «موعدك مع الطبيب بعد 5 دقائق» (نمط منبّه)", () => {
  const appt = { id: "a1", date: new Date("2026-10-01T00:00:00Z"), startTime: "10:00", doctor: { firstName: "أحمد", lastName: "بن علي" } };
  const payloadsOf = (title: string) => h.sendPushToUser.mock.calls.map((c) => c[1] as any).filter((p) => p.title === title);
  const FIVE = "موعدك مع الطبيب بعد 5 دقائق";

  it("الحمولة: النص المطلوب + نوع المنبّه + أولوية عالية + لا تسليم بعد بداية الموعد", () => {
    const p = buildReminderPayload("FIVE_MINUTES" as any, appt, new Date("2026-10-01T08:55:00Z"));
    expect(p.title).toBe(FIVE);
    expect(p.kind).toBe("APPOINTMENT_5MIN_ALARM");
    expect(p.urgency).toBe("high");
    expect(p.deliverBy).toBe("2026-10-01T09:00:00.000Z"); // 10:00 بتوقيت الجزائر
    expect(p.tag).toBe("appt-a1");
  });

  it("تذكير الساعة لا يحمل نوع المنبّه ولا أولوية خاصة (سلوكه كما كان)، ويُسقط إن تأخر تسليمه حتى نافذة الخمس دقائق", () => {
    const p = buildReminderPayload("ONE_HOUR" as any, appt, new Date("2026-10-01T08:00:00Z"));
    expect(p.kind).toBeUndefined();
    expect(p.urgency).toBeUndefined();
    expect(p.title).toBe("🔔 تذكير بموعدك");
    expect(p.deliverBy).toBe("2026-10-01T08:55:00.000Z");
  });

  it("موعد بعد أكثر من 5 دقائق: لا يُرسل تنبيه الخمس دقائق", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 30 * MIN));
    await runReminderCycle(new Date(START.getTime() - 5 * MIN - 1000));
    expect(payloadsOf(FIVE)).toHaveLength(0);
    expect(reminder("a1", "FIVE_MINUTES")!.status).toBe("PENDING");
  });

  it("عند الوصول إلى نافذة الخمس دقائق: إشعار واحد بنوع المنبّه، ولا يتكرر مع إعادة التشغيل", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 61 * MIN));
    await runReminderCycle(new Date(START.getTime() - 60 * MIN));
    for (const m of [5, 4.5, 4, 3, 1]) await runReminderCycle(new Date(START.getTime() - m * MIN));
    const five = payloadsOf(FIVE);
    expect(five).toHaveLength(1);
    expect(five[0]).toMatchObject({ kind: "APPOINTMENT_5MIN_ALARM", urgency: "high" });
    // تذكير الساعة أُرسل مرة واحدة، بلا نوع المنبّه — لا تعارض بينهما.
    const one = payloadsOf("🔔 تذكير بموعدك");
    expect(one).toHaveLength(1);
    expect(one[0].kind).toBeUndefined();
    expect(reminder("a1", "FIVE_MINUTES")!.status).toBe("SENT");
  });

  it("حجز قبل 20 دقيقة: تذكير الساعة فورًا (كما كان) ثم تنبيه الخمس دقائق مرة واحدة", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 20 * MIN));
    await runReminderCycle(new Date(START.getTime() - 4 * MIN));
    await runReminderCycle(new Date(START.getTime() - 3 * MIN));
    expect(h.sendPushToUser).toHaveBeenCalledTimes(2);
    expect(payloadsOf(FIVE)).toHaveLength(1);
  });

  it("أول دورة داخل نافذة الخمس دقائق (خادم كان نائمًا): تنبيه الخمس دقائق وحده، وتذكير الساعة SUPERSEDED", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 4 * MIN));
    await runReminderCycle(new Date(START.getTime() - 3 * MIN));
    expect(h.sendPushToUser).toHaveBeenCalledTimes(1);
    expect(payloadsOf(FIVE)).toHaveLength(1);
    expect(reminder("a1", "ONE_HOUR")).toMatchObject({ status: "SKIPPED", skipReason: "superseded" });
  });

  it("بعد بداية الموعد: لا تنبيه متأخر", async () => {
    addAppt("a1", START);
    await runReminderCycle(new Date(START.getTime() - 61 * MIN));
    await runReminderCycle(new Date(START.getTime() + 1 * MIN));
    expect(payloadsOf(FIVE)).toHaveLength(0);
    expect(reminder("a1", "FIVE_MINUTES")).toMatchObject({ status: "SKIPPED", skipReason: "expired" });
  });
});
