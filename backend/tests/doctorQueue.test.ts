/** التعريف المشترك للطابور (lib/doctorQueue.ts) + تقدير وقت الدور — دوال نقية بلا قاعدة بيانات. */
import { describe, it, expect } from "vitest";
import { locateInQueue, estimateMinutesUntilTurn, isQueueDayClosed } from "../src/lib/doctorQueue";

const MIN = 60_000;
const NOW = new Date("2031-03-11T14:40:00Z"); // 15:40 بتوقيت الجزائر
const row = (id: string, startTime: string, status: string, extra: Partial<{ skipCredits: number; calledAt: Date }> = {}) => ({
  id, startTime, status: status as any, skipCredits: extra.skipCredits ?? 0, calledAt: extra.calledAt ?? null,
});

describe("locateInQueue", () => {
  it("المنتظرون CONFIRMED/LATE فقط؛ PENDING والمحسومون خارج الطابور؛ IN_PROGRESS بالداخل", () => {
    const q = [row("A", "15:00", "IN_PROGRESS"), row("B", "15:10", "CONFIRMED"), row("C", "15:20", "CONFIRMED")];
    expect(locateInQueue(q, "C")).toMatchObject({ waiting: true, index: 1, insideOther: true, aheadOfYou: 2 });
    expect(locateInQueue(q, "A")).toMatchObject({ waiting: false, inProgress: true });
    expect(locateInQueue(q, "Z").waiting).toBe(false);
  });

  it("LATE يتراجع بحسب رصيده (نفس projectQueueOrder) ويبقى داخل الطابور", () => {
    const q = [row("L", "15:00", "LATE", { skipCredits: 2 }), row("B", "15:10", "CONFIRMED"), row("C", "15:20", "CONFIRMED"), row("D", "15:30", "CONFIRMED")];
    expect(locateInQueue(q, "L")).toMatchObject({ waiting: true, index: 2 });
  });
});

describe("estimateMinutesUntilTurn", () => {
  const q = (calledMinAgo: number) => [row("A", "15:00", "IN_PROGRESS", { calledAt: new Date(NOW.getTime() - calledMinAgo * MIN) }), row("B", "15:10", "CONFIRMED"), row("C", "15:20", "CONFIRMED")];

  it("= ما تبقى للموجود بالداخل + المنتظرون قبله × المدة الذكية", () => {
    expect(estimateMinutesUntilTurn(locateInQueue(q(1), "C"), 5, NOW)).toBe(4 + 5);
    expect(estimateMinutesUntilTurn(locateInQueue(q(1), "B"), 5, NOW)).toBe(4);
  });

  it("الطبيب تجاوز المدة المعتادة: المتبقي دقيقة واحدة على الأقل (قد ينهي في أي لحظة)", () => {
    expect(estimateMinutesUntilTurn(locateInQueue(q(30), "C"), 5, NOW)).toBe(1 + 5);
  });

  it("ليس منتظرًا → null", () => {
    expect(estimateMinutesUntilTurn(locateInQueue(q(1), "A"), 5, NOW)).toBeNull();
  });
});

describe("isQueueDayClosed", () => {
  it("بعد وقت إغلاق الطبيب يُعدّ الطابور مغلقًا (نفس قاعدة الكنس التلقائي)", () => {
    const day = new Date("2031-03-11T00:00:00Z");
    const schedules = [{ dayOfWeek: day.getUTCDay(), startTime: "08:00", endTime: "12:00", isOff: false, isException: false, exceptionDate: null }] as any;
    expect(isQueueDayClosed(day, schedules, new Date("2031-03-11T10:59:00Z"))).toBe(false); // 11:59
    expect(isQueueDayClosed(day, schedules, new Date("2031-03-11T11:01:00Z"))).toBe(true); // 12:01
  });
});
