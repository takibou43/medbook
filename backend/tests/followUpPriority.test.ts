/**
 * موعد المتابعة الطبية من «خطط العلاج»: المنطق النقي (بلا قاعدة بيانات).
 *  - القيمة الداخلية slotSeq (nextFollowUpSeq): 0 للوقت الشاغر، وإلا أكبر قيمة + 1.
 *  - الأولوية في الطابور تعتمد العلامة doctorFollowUp (وslotSeq كترتيب إنشاء) لا الثواني، وعند تساوي الوقت الظاهر فقط.
 *  - الصفوف القديمة (بلا العلامة) ترتيبها كما كان تمامًا.
 */
import { describe, it, expect } from "vitest";
import { nextFollowUpSeq } from "../src/lib/slotAssign";
import { firstPresent, presentQueueOrder, followUpRankCompare } from "../src/lib/presentQueue";
import { pickNext, projectQueueOrder } from "../src/lib/queueOrder";

const row = (id: string, startTime: string, extra: Record<string, unknown> = {}) => ({
  id, startTime, status: "CONFIRMED", skipCredits: 0, arrivedAt: new Date(), urgencyStatus: "NONE", doctorFollowUp: false, slotSeq: 0, ...extra,
});

describe("nextFollowUpSeq — القيمة الداخلية الفريدة", () => {
  it("وقت شاغر → 0 (يبقى كأي حجز عادي)", () => expect(nextFollowUpSeq([])).toBe(0));
  it("وقت مشغول بموعد واحد (slotSeq 0) → 1", () => expect(nextFollowUpSeq([{ slotSeq: 0 }])).toBe(1));
  it("عدة متابعات في نفس الدقيقة → قيم متتالية فريدة", () => {
    const rows = [{ slotSeq: 0 }];
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const n = nextFollowUpSeq(rows);
      seen.push(n);
      rows.push({ slotSeq: n });
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(seen).size).toBe(seen.length);
  });
  it("لا يعيد استعمال قيمة قائمة حتى مع فجوات (متابعة ملغاة لا تظهر في المدخلات)", () => {
    expect(nextFollowUpSeq([{ slotSeq: 0 }, { slotSeq: 3 }])).toBe(4);
  });
});

describe("أولوية المتابعة الطبية في ترتيب الطابور", () => {
  it("في نفس الوقت الظاهر: المتابعة قبل الحجز العادي مهما كان المعرّف", () => {
    const rows = [row("a-regular", "10:00"), row("z-follow", "10:00", { doctorFollowUp: true, slotSeq: 1 })];
    expect(presentQueueOrder(rows).map((r) => r.id)).toEqual(["z-follow", "a-regular"]);
    expect(firstPresent(rows)?.id).toBe("z-follow");
    expect(pickNext(rows as any)?.id).toBe("z-follow");
    expect(projectQueueOrder(rows as any).map((r) => r.id)).toEqual(["z-follow", "a-regular"]);
  });
  it("المتابعات المتزامنة تُرتَّب بترتيب إنشائها (slotSeq) ثم تأتي العادية", () => {
    const rows = [
      row("r", "10:00"),
      row("f3", "10:00", { doctorFollowUp: true, slotSeq: 3 }),
      row("f1", "10:00", { doctorFollowUp: true, slotSeq: 1 }),
      row("f2", "10:00", { doctorFollowUp: true, slotSeq: 2 }),
    ];
    expect(presentQueueOrder(rows).map((r) => r.id)).toEqual(["f1", "f2", "f3", "r"]);
  });
  it("لا تسبق المتابعة موعدًا أبكر وقتًا (الأولوية عند تساوي الوقت الظاهر فقط)", () => {
    const rows = [row("early", "09:40"), row("f", "10:00", { doctorFollowUp: true, slotSeq: 1 })];
    expect(presentQueueOrder(rows).map((r) => r.id)).toEqual(["early", "f"]);
    expect(pickNext(rows as any)?.id).toBe("early");
  });
  it("الحاضر يسبق الغائب كما كان (لا يتوقف الطابور بانتظار متابعة لم تحضر)", () => {
    const rows = [row("present", "10:00"), row("follow-absent", "10:00", { doctorFollowUp: true, slotSeq: 1, arrivedAt: null })];
    expect(presentQueueOrder(rows).map((r) => r.id)).toEqual(["present", "follow-absent"]);
    expect(firstPresent(rows)?.id).toBe("present");
  });
  it("الصفوف القديمة بلا العلامة: الترتيب كما كان (الوقت ثم المعرّف)", () => {
    const rows = [row("b", "10:00"), row("a", "10:00"), row("c", "09:00")];
    expect(presentQueueOrder(rows).map((r) => r.id)).toEqual(["c", "a", "b"]);
    const legacy = [{ id: "b", startTime: "10:00", arrivedAt: null }, { id: "a", startTime: "10:00", arrivedAt: null }];
    expect(presentQueueOrder(legacy).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("منطق المتأخر محفوظ: LATE برصيد لا يسبق، وLATE نفد رصيده يُنادى فورًا حتى أمام متابعة", () => {
    const rows = [
      row("late", "09:00", { status: "LATE", skipCredits: 0 }),
      row("f", "10:00", { doctorFollowUp: true, slotSeq: 1 }),
    ];
    expect(pickNext(rows as any)?.id).toBe("late");
    const credit = [row("late", "09:00", { status: "LATE", skipCredits: 2 }), row("f", "10:00", { doctorFollowUp: true, slotSeq: 1 }), row("r", "10:00")];
    expect(projectQueueOrder(credit as any).map((r) => r.id)).toEqual(["f", "r", "late"]);
  });
  it("المقارن لا يستعمل أي ثوانٍ: قيم الوقت الظاهر نصية HH:mm فقط", () => {
    expect(followUpRankCompare({ doctorFollowUp: true, slotSeq: 2 }, { doctorFollowUp: true, slotSeq: 1 })).toBeGreaterThan(0);
    expect(followUpRankCompare({}, { doctorFollowUp: false, slotSeq: 0 })).toBe(0);
    for (const r of [row("x", "10:00")]) expect(r.startTime).toMatch(/^\d{2}:\d{2}$/);
  });
});
