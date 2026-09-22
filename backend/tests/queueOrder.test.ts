/**
 * منطق ترتيب الطابور وعقوبة التأخير (lib/queueOrder.ts) — دوال نقية، مع محاكاة لنفس خطوات الخادم:
 *   مناداة التالي = pickNext ثم IN_PROGRESS ثم إنقاص رصيد المتأخرين الآخرين (كما في callNextPatient)،
 *   «متأخر» = LATE + deferredCount+1 + skipCredits = latePenaltyFor(العدّاد الجديد) (كما في markAsLate).
 */
import { describe, it, expect } from "vitest";
import { latePenaltyFor, pickNext, projectQueueOrder, FIRST_LATE_PENALTY, REPEAT_LATE_PENALTY } from "../src/lib/queueOrder";

type St = "CONFIRMED" | "LATE" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
interface Appt { id: string; status: St; startTime: string; skipCredits: number; deferredCount: number }

function makeQueue(names: string[]): Appt[] {
  return names.map((id, i) => ({ id, status: "CONFIRMED", startTime: `09:${String(i * 5).padStart(2, "0")}`, skipCredits: 0, deferredCount: 0 }));
}
const waitingOf = (q: Appt[]) => q.filter((a) => a.status === "CONFIRMED" || a.status === "LATE");
const order = (q: Appt[]) => projectQueueOrder(waitingOf(q)).map((a) => a.id);

function callNext(q: Appt[]): string {
  const next = pickNext(waitingOf(q))!;
  next.status = "IN_PROGRESS";
  for (const a of q) if (a.status === "LATE" && a.skipCredits > 0 && a.id !== next.id) a.skipCredits -= 1;
  return next.id;
}
function markLate(q: Appt[], id: string) {
  const a = q.find((x) => x.id === id)!;
  if (a.status === "LATE") return; // تكرار: لا حدث جديد
  a.deferredCount += 1;
  a.status = "LATE";
  a.skipCredits = latePenaltyFor(a.deferredCount);
}
const finish = (q: Appt[], id: string) => (q.find((x) => x.id === id)!.status = "COMPLETED");

describe("العقوبة بالمراكز (وليست دقائق)", () => {
  it("1) بلا تأخير: 0 — 2) الأول: 2 — 3/4/5) الثاني والثالث والرابع: 4 لكل واحد", () => {
    expect(latePenaltyFor(0)).toBe(0);
    expect(latePenaltyFor(1)).toBe(2);
    expect([2, 3, 4, 5, 10].map(latePenaltyFor)).toEqual([4, 4, 4, 4, 4]);
    expect([FIRST_LATE_PENALTY, REPEAT_LATE_PENALTY]).toEqual([2, 4]);
  });

  it("عدّاد التأخير مرتبط بالموعد: موعد جديد يبدأ من صفر", () => {
    const monday = makeQueue(["A"]);
    callNext(monday);
    markLate(monday, "A");
    callNext(monday);
    markLate(monday, "A");
    expect(monday[0].deferredCount).toBe(2);
    const tuesday = makeQueue(["A"]);
    expect(tuesday[0].deferredCount).toBe(0);
    expect(tuesday[0].skipCredits).toBe(0);
  });
});

describe("الترتيب", () => {
  it("مريض لم يتأخر: الترتيب حسب وقت الموعد دون أي عقوبة", () => {
    expect(order(makeQueue(["A", "B", "C", "D"]))).toEqual(["A", "B", "C", "D"]);
  });

  it("23) A B C D E F — A يتأخر: B C A D E F، ثم عند تأخره الثاني +4", () => {
    const q = makeQueue(["A", "B", "C", "D", "E", "F"]);
    expect(callNext(q)).toBe("A");
    markLate(q, "A");
    expect(order(q)).toEqual(["B", "C", "A", "D", "E", "F"]);

    // الطابور يسير فعليًا: B ثم C ثم يعود A
    expect(callNext(q)).toBe("B");
    finish(q, "B");
    expect(callNext(q)).toBe("C");
    finish(q, "C");
    expect(callNext(q)).toBe("A");
    // A لم يحضر مرة ثانية: +4 مراكز من الطابور الحالي (D E F فقط موجودون)
    markLate(q, "A");
    expect(q[0]).toMatchObject({ deferredCount: 2, skipCredits: 4 });
    expect(order(q)).toEqual(["D", "E", "F", "A"]); // لا يتجاوز حدود الطابور
  });

  it("المثال الكامل: 8 مرضى، الأول +2 ثم +4 بحساب الطابور الحالي", () => {
    const q = makeQueue(["أحمد", "محمد", "علي", "سمير", "كريم", "يوسف", "خالد", "سليم"]);
    callNext(q);
    markLate(q, "أحمد");
    expect(order(q)).toEqual(["محمد", "علي", "أحمد", "سمير", "كريم", "يوسف", "خالد", "سليم"]);
    for (const n of ["محمد", "علي"]) {
      expect(callNext(q)).toBe(n);
      finish(q, n);
    }
    expect(callNext(q)).toBe("أحمد");
    markLate(q, "أحمد");
    expect(order(q)).toEqual(["سمير", "كريم", "يوسف", "خالد", "أحمد", "سليم"]);
  });

  it("24) A..H: A +2 ثم B +2 ثم A +4 — لا تكرار ولا فقدان لأي مريض", () => {
    const q = makeQueue(["A", "B", "C", "D", "E", "F", "G", "H"]);
    callNext(q); // A
    markLate(q, "A");
    expect(order(q)).toEqual(["B", "C", "A", "D", "E", "F", "G", "H"]);

    callNext(q); // B
    markLate(q, "B");
    // B تراجع مركزين من الطابور الحالي [C, A, D, ...]
    expect(order(q)).toEqual(["C", "A", "B", "D", "E", "F", "G", "H"]);

    expect(callNext(q)).toBe("C");
    finish(q, "C");
    expect(callNext(q)).toBe("A");
    markLate(q, "A"); // تأخيره الثاني: +4
    expect(order(q)).toEqual(["B", "D", "E", "F", "A", "G", "H"]);

    const all = order(q);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(["A", "B", "D", "E", "F", "G", "H"]);
  });

  it("6) الحدود: لم يبق بعده إلا مريض واحد — يعود بعده مباشرة ولا يعلق الطابور", () => {
    const q = makeQueue(["A", "B"]);
    callNext(q);
    markLate(q, "A");
    expect(order(q)).toEqual(["B", "A"]);
    callNext(q);
    finish(q, "B");
    // رصيده ما زال 1 ولا أحد غيره: يُنادى هو (لا خطأ «كل المتأخرين ينتظرون»)
    expect(callNext(q)).toBe("A");
  });

  it("وحده في الطابور ويتأخر: يبقى في الطابور ويمكن مناداته", () => {
    const q = makeQueue(["A"]);
    callNext(q);
    markLate(q, "A");
    expect(order(q)).toEqual(["A"]);
    expect(callNext(q)).toBe("A");
  });

  it("16) عدة متأخرين: ترتيب حتمي لا يتغيّر بتغيّر ترتيب المدخلات", () => {
    const base: Appt[] = [
      { id: "A", status: "LATE", startTime: "09:00", skipCredits: 1, deferredCount: 1 },
      { id: "M", status: "LATE", startTime: "09:05", skipCredits: 1, deferredCount: 1 },
      { id: "L", status: "LATE", startTime: "09:10", skipCredits: 4, deferredCount: 2 },
      { id: "X", status: "CONFIRMED", startTime: "09:15", skipCredits: 0, deferredCount: 0 },
      { id: "Y", status: "CONFIRMED", startTime: "09:20", skipCredits: 0, deferredCount: 0 },
    ];
    const expected = projectQueueOrder(base).map((a) => a.id);
    for (let i = 0; i < 10; i++) {
      const shuffled = [...base].sort(() => (i % 2 ? 1 : -1));
      expect(projectQueueOrder(shuffled.reverse()).map((a) => a.id)).toEqual(expected);
    }
    expect(expected).toEqual(["X", "A", "M", "Y", "L"]);
  });

  it("25) الضغط على «متأخر» مرتين لنفس الحدث: عملية واحدة فقط", () => {
    const q = makeQueue(["A", "B", "C"]);
    callNext(q);
    markLate(q, "A");
    markLate(q, "A");
    expect(q[0]).toMatchObject({ deferredCount: 1, skipCredits: 2 });
  });

  it("28) COMPLETED / CANCELLED / NO_SHOW لا تعود للطابور، و LATE تبقى فيه", () => {
    const q = makeQueue(["A", "B", "C", "D"]);
    q[0].status = "COMPLETED";
    q[1].status = "CANCELLED";
    q[2].status = "NO_SHOW";
    q[3].status = "LATE";
    q[3].skipCredits = 2;
    expect(order(q)).toEqual(["D"]);
  });

  it("projectQueueOrder لا يعدّل المدخلات", () => {
    const q = makeQueue(["A", "B", "C"]);
    callNext(q);
    markLate(q, "A");
    const snapshot = JSON.stringify(q);
    order(q);
    expect(JSON.stringify(q)).toBe(snapshot);
  });
});
