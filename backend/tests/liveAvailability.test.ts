/**
 * توفر المواعيد حسب الحالة الفعلية لطابور الطبيب (lib/liveAvailability.ts) — دوال نقية بلا قاعدة بيانات.
 * يوم الاختبار: الاثنين 2026-10-05، دوام 09:00–12:00 و 14:00–17:00، مدة الجلسة 20 دقيقة.
 * «الآن» يُمرَّر صراحة (nowMs) فلا تعتمد النتائج على ساعة التشغيل.
 */
import { describe, it, expect } from "vitest";
import { computeLiveSlots, dayAvailability, liveEarliestMinute, queueHasPatientsNow, workingBlocksFor } from "../src/lib/liveAvailability";

const DAY = new Date("2026-10-05T00:00:00Z"); // الاثنين
const SCHEDULE = [
  { dayOfWeek: 1, startTime: "09:00", endTime: "12:00", isException: false, exceptionDate: null, isOff: false },
  { dayOfWeek: 1, startTime: "14:00", endTime: "17:00", isException: false, exceptionDate: null, isOff: false },
];
const DUR = 20;
/** لحظة بتوقيت الجزائر (UTC+1) يوم الاختبار. */
const at = (hhmm: string, sec = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 9, 5, h - 1, m, sec);
};
const pastFnAt = (nowMs: number) => (date: Date, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h - 1, m) < nowMs;
};
const add = (hhmm: string, min: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
/** جدول ممتلئ بالكامل: كل خانة من الدوام محجوزة بالحالة المعطاة. */
function fullDay(status: any = "COMPLETED") {
  const list: { startTime: string; endTime: string; status: any }[] = [];
  for (const [s, e] of [["09:00", "12:00"], ["14:00", "17:00"]]) {
    for (let t = s; t < e; t = add(t, DUR)) list.push({ startTime: t, endTime: add(t, DUR), status });
  }
  return list;
}
const avail = (appointments: any[], now: number) =>
  dayAvailability({ date: DAY, schedules: SCHEDULE, appointments, slotMinutes: DUR, nowMs: now, isPastFn: pastFnAt(now) });

describe("الأدوات الأساسية", () => {
  it("أول وقت حي: بعد الآن ومقرّب لأعلى لمضاعف 5 دقائق (لا ماضٍ)", () => {
    expect(liveEarliestMinute(15 * 60 + 20, 0)).toBe(15 * 60 + 20);
    expect(liveEarliestMinute(15 * 60 + 20, 30)).toBe(15 * 60 + 25);
    expect(liveEarliestMinute(15 * 60 + 17, 0)).toBe(15 * 60 + 20);
  });
  it("فترات العمل تحترم الاستثناءات (يوم عطلة = لا فترات)", () => {
    expect(workingBlocksFor(DAY, SCHEDULE)).toHaveLength(2);
    const off = [...SCHEDULE, { dayOfWeek: null, startTime: "00:00", endTime: "23:59", isException: true, exceptionDate: DAY, isOff: true }];
    expect(workingBlocksFor(DAY, off as any)).toEqual([]);
  });
  it("الطابور غير فارغ: IN_PROGRESS أو LATE أو موعد نشط حلّ وقته", () => {
    const now = 15 * 60 + 20;
    expect(queueHasPatientsNow([{ startTime: "15:00", endTime: "15:20", status: "IN_PROGRESS" as any }], now)).toBe(true);
    expect(queueHasPatientsNow([{ startTime: "16:40", endTime: "17:00", status: "LATE" as any }], now)).toBe(true);
    expect(queueHasPatientsNow([{ startTime: "15:20", endTime: "15:40", status: "CONFIRMED" as any }], now)).toBe(true);
    expect(queueHasPatientsNow([{ startTime: "15:40", endTime: "16:00", status: "CONFIRMED" as any }], now)).toBe(false);
    expect(queueHasPatientsNow([{ startTime: "15:00", endTime: "15:20", status: "COMPLETED" as any }, { startTime: "15:00", endTime: "15:20", status: "NO_SHOW" as any }], now)).toBe(false);
  });
});

describe("توفر اليوم حسب حالة الطابور", () => {
  it("1+9) كل مواعيد اليوم COMPLETED والطبيب ما زال في دوامه → أوقات حية جديدة من الآن (15:20)", () => {
    const now = at("15:20");
    // الشبكة وحدها: لا شيء (كل الخانات «محجوزة»)
    const r = avail(fullDay("COMPLETED"), now);
    expect(r.live).toBe(true);
    // 15:20 نفسها وقت بداية موعد مكتمل (قيد فريد) → 15:21، ثم متسلسلة بلا تداخل حتى نهاية الدوام 17:00
    expect(r.slots).toEqual(["15:21", "15:41", "16:01", "16:21"]);
    for (const s of r.slots) expect(pastFnAt(now)(DAY, s)).toBe(false);
  });

  it("مثال المواصفة: آخر موعد انتهى 15:10، الآن 15:18، المدة 20 → 15:20 تقريبًا (أقرب وقت يسمح به النظام)", () => {
    const appts = fullDay("COMPLETED").filter((a) => a.startTime !== "15:20");
    const r = avail(appts, at("15:18"));
    expect(r.slots[0]).toBe("15:20");
  });

  it("2) يوجد IN_PROGRESS → الطابور ليس فارغًا: لا أوقات حية (الشبكة كما كانت = لا شيء)", () => {
    const appts = fullDay("COMPLETED");
    appts.find((a) => a.startTime === "15:00")!.status = "IN_PROGRESS";
    const r = avail(appts, at("15:20"));
    expect(r).toEqual({ slots: [], live: false });
  });

  it("3) مواعيد مؤكدة قادمة اليوم → لا أوقات حية تتعارض معها", () => {
    const appts = fullDay("COMPLETED");
    appts.find((a) => a.startTime === "16:00")!.status = "CONFIRMED";
    appts.find((a) => a.startTime === "16:40")!.status = "CONFIRMED";
    const r = avail(appts, at("15:20"));
    expect(r.live).toBe(true);
    // 15:21–15:41 ✓، 15:41–16:01 يتداخل مع 16:00 → بعد 16:20: 16:20 بداية موعد (قيد فريد) → 16:21–16:41 يتداخل مع 16:40 → بعد 17:00 لا شيء
    expect(r.slots).toEqual(["15:21"]);
    for (const s of r.slots) {
      const [h, m] = s.split(":").map(Number);
      const st = h * 60 + m;
      for (const c of [16 * 60, 16 * 60 + 40]) expect(st < c + DUR && c < st + DUR).toBe(false);
    }
  });

  it("4) يوجد مريض LATE → مكانه غير متاح ولا يُعتبر الطابور فارغًا", () => {
    const appts = fullDay("COMPLETED");
    appts.find((a) => a.startTime === "14:40")!.status = "LATE";
    expect(avail(appts, at("15:20"))).toEqual({ slots: [], live: false });
  });

  it("5) مواعيد CANCELLED → تحرّر وقتها كما هو الحال (الشبكة تعرضه) ولا تحجب الأوقات الحية", () => {
    const appts = fullDay("CONFIRMED").map((a) => ({ ...a, status: a.startTime < "15:20" ? "COMPLETED" : "CONFIRMED" }));
    appts.find((a) => a.startTime === "16:00")!.status = "CANCELLED";
    const r = avail(appts, at("15:20"));
    // لا أوقات حية (15:20–16:00 و16:20–17:00 مؤكدة قادمة)، والشبكة تعرض 16:00 المحرَّر كما كانت تفعل
    expect(r.slots).toEqual(["16:00"]);
    // الملغى لا يحجب شيئًا حتى لو مُرّر: كل مواعيد ما بعد الظهر ملغاة → الشبكة كلها متاحة
    const allCancelled = fullDay("COMPLETED").map((a) => (a.startTime >= "15:20" ? { ...a, status: "CANCELLED" } : a));
    expect(avail(allCancelled, at("15:20")).slots).toEqual(["15:20", "15:40", "16:00", "16:20", "16:40"]);
  });

  it("6) NO_SHOW → ليس في الطابور (لا يحجب الوقت الحي)، ووقت بدايته نفسه لا يُعاد (القاعدة الحالية للقيد الفريد)", () => {
    const appts = fullDay("COMPLETED").map((a) => (a.startTime >= "15:20" ? { ...a, status: "NO_SHOW" } : a));
    const r = avail(appts, at("15:20"));
    expect(r.live).toBe(true);
    expect(r.slots).toContain("15:21");
    for (const a of appts) expect(r.slots).not.toContain(a.startTime);
  });

  it("7) الوقت الحالي تجاوز آخر موعد → لا أوقات في الماضي", () => {
    const appts = fullDay("COMPLETED");
    const r = avail(appts, at("16:47", 10));
    expect(r.slots.every((s) => s >= "16:50")).toBe(true);
    // 16:50 + 20 = 17:10 > 17:00 نهاية الدوام → لا شيء
    expect(r.slots).toEqual([]);
  });

  it("8) انتهت ساعات عمل الطبيب → لا حجز جديد", () => {
    expect(avail(fullDay("COMPLETED"), at("17:05")).slots).toEqual([]);
    expect(avail([], at("17:05")).slots).toEqual([]);
  });

  it("الاستراحة بين الفترتين: لا وقت حي داخلها — يبدأ من بداية الفترة التالية", () => {
    const r = avail(fullDay("COMPLETED"), at("12:30"));
    expect(r.slots[0]).toBe("14:01"); // 14:00 بداية موعد مكتمل
    expect(r.slots.every((s) => s >= "14:00")).toBe(true);
  });

  it("يوم آخر (غدًا) → الشبكة وحدها كما كانت، بلا أوقات حية", () => {
    const tomorrow = new Date("2026-10-06T00:00:00Z"); // الثلاثاء: لا دوام في هذا الجدول
    expect(computeLiveSlots({ date: tomorrow, schedules: SCHEDULE, appointments: [], slotMinutes: DUR, nowMs: at("15:20") })).toBeNull();
    const nextMonday = new Date("2026-10-12T00:00:00Z");
    const r = dayAvailability({ date: nextMonday, schedules: SCHEDULE, appointments: fullDay("COMPLETED"), slotMinutes: DUR, nowMs: at("15:20"), isPastFn: pastFnAt(at("15:20")) });
    expect(r).toEqual({ slots: [], live: false });
  });

  it("يوم عادي بلا مواعيد منتهية مبكرًا: النتيجة مطابقة للشبكة القديمة تمامًا (لا تغيير في السلوك)", () => {
    const now = at("10:05");
    const appts = fullDay("CONFIRMED").filter((a) => a.startTime > "10:05" && a.startTime !== "11:00");
    const r = avail(appts, now);
    expect(r.live).toBe(false);
    expect(r.slots).toEqual(["11:00"]);
    // وبلا أي موعد: الشبكة كاملة من 10:20 كما كانت (الفراغ 10:05–10:20 أقصر من الجلسة فلا وقت حي)
    const empty = avail([], now);
    expect(empty.live).toBe(false);
    expect(empty.slots[0]).toBe("10:20");
  });

  it("الأوقات الحية لا تتداخل مع أوقات الشبكة الشاغرة (مريضان لا يُعطيان وقتين متداخلين)", () => {
    const appts = fullDay("COMPLETED").filter((a) => a.startTime !== "16:00"); // 16:00 خانة شبكة شاغرة
    const r = avail(appts, at("15:20"));
    expect(r.slots).toContain("16:00");
    const mins = r.slots.map((s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)));
    for (let i = 1; i < mins.length; i++) expect(mins[i] - mins[i - 1]).toBeGreaterThanOrEqual(DUR);
  });
});
