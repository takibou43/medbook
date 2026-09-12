import { describe, it, expect } from "vitest";
import { generateAvailableSlots, isWithinWorkingHours, isPast, ScheduleBlock } from "../src/lib/slots";

// Sunday..Thursday 08:00-12:00 (نفس جدول العمل الافتراضي في seed.ts)
const weeklySchedule: ScheduleBlock[] = [
  { dayOfWeek: 0, startTime: "08:00", endTime: "12:00", isException: false, exceptionDate: null, isOff: false },
  { dayOfWeek: 1, startTime: "08:00", endTime: "12:00", isException: false, exceptionDate: null, isOff: false },
  { dayOfWeek: 2, startTime: "08:00", endTime: "12:00", isException: false, exceptionDate: null, isOff: false },
  { dayOfWeek: 3, startTime: "08:00", endTime: "12:00", isException: false, exceptionDate: null, isOff: false },
  { dayOfWeek: 4, startTime: "08:00", endTime: "12:00", isException: false, exceptionDate: null, isOff: false },
];

// ملاحظة مهمة: كل منطق التوفّر في src/lib/slots.ts يعمل بتوقيت UTC (getUTCDay)، لأن الخادم
// يستقبل التاريخ كسلسلة "YYYY-MM-DD" ويحوّله إلى منتصف ليل UTC: new Date(date + "T00:00:00Z").
// لذلك يجب أن تبني الاختبارات تواريخها بنفس الطريقة، وإلا فشلت على أي جهاز خارج UTC
// (الجزائر UTC+1 مثلًا: منتصف ليل محلي = 23:00 من اليوم السابق بتوقيت UTC → انزياح يوم كامل).
function nextDateForDay(targetDow: number): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  d.setUTCDate(d.getUTCDate() + ((7 + targetDow - d.getUTCDay()) % 7 || 7)); // أقرب يوم قادم لتفادي فترات الماضي
  return d;
}

describe("generateAvailableSlots — منع الحجز المزدوج (Double Booking)", () => {
  it("يولّد فترات كل 20 دقيقة ضمن ساعات العمل", () => {
    const sunday = nextDateForDay(0);
    const slots = generateAvailableSlots(sunday, weeklySchedule, [], 20);
    expect(slots[0]).toBe("08:00");
    expect(slots).toContain("11:40");
    expect(slots).not.toContain("12:00"); // لا تتجاوز نهاية الفترة
    expect(slots.length).toBe(12); // 4 ساعات / 20 دقيقة
  });

  it("يستبعد الفترات المحجوزة مسبقًا (PENDING/CONFIRMED)", () => {
    const sunday = nextDateForDay(0);
    const booked = [{ startTime: "09:00", endTime: "09:20" }];
    const slots = generateAvailableSlots(sunday, weeklySchedule, booked, 20);
    expect(slots).not.toContain("09:00");
    expect(slots).toContain("08:40");
    expect(slots).toContain("09:20");
  });

  it("لا يسمح بحجز فترة متداخلة جزئيًا مع فترة محجوزة", () => {
    const sunday = nextDateForDay(0);
    // فترة محجوزة من 09:10 إلى 09:30 (متداخلة مع slot 09:00-09:20 و 09:20-09:40)
    const booked = [{ startTime: "09:10", endTime: "09:30" }];
    const slots = generateAvailableSlots(sunday, weeklySchedule, booked, 20);
    expect(slots).not.toContain("09:00");
    expect(slots).not.toContain("09:20");
  });

  it("يرجع مصفوفة فارغة في يوم عطلة (الجمعة)", () => {
    const friday = nextDateForDay(5);
    const slots = generateAvailableSlots(friday, weeklySchedule, [], 20);
    expect(slots).toEqual([]);
  });

  it("يحترم استثناء يوم عطلة استثنائي (إجازة) حتى لو كان يوم عمل عادي", () => {
    const sunday = nextDateForDay(0);
    const scheduleWithException: ScheduleBlock[] = [
      ...weeklySchedule,
      { dayOfWeek: null, startTime: "00:00", endTime: "23:59", isException: true, exceptionDate: sunday, isOff: true },
    ];
    const slots = generateAvailableSlots(sunday, scheduleWithException, [], 20);
    expect(slots).toEqual([]);
  });
});

describe("isWithinWorkingHours — رفض الحجز خارج أوقات عمل الطبيب", () => {
  it("يقبل فترة داخل أوقات العمل", () => {
    const sunday = nextDateForDay(0);
    expect(isWithinWorkingHours(sunday, "09:00", "09:20", weeklySchedule)).toBe(true);
  });

  it("يرفض فترة خارج أوقات العمل", () => {
    const sunday = nextDateForDay(0);
    expect(isWithinWorkingHours(sunday, "13:00", "13:20", weeklySchedule)).toBe(false);
  });

  it("يرفض الحجز في يوم عطلة", () => {
    const friday = nextDateForDay(5);
    expect(isWithinWorkingHours(friday, "09:00", "09:20", weeklySchedule)).toBe(false);
  });
});

describe("isPast — منع الحجز في وقت مضى", () => {
  it("يعتبر تاريخ الأمس في الماضي", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isPast(yesterday, "09:00")).toBe(true);
  });

  it("يعتبر تاريخًا بعيدًا في المستقبل غير ماضٍ", () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    expect(isPast(future, "09:00")).toBe(false);
  });
});
