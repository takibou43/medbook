/**
 * مشاركة الدقيقة المشغولة لموعد المتابعة الطبية (فوق PR #48): المنطق النقي.
 *  - nextFollowUpSeq: القيمة الداخلية الفريدة (0 للشاغر، وإلا أكبر + 1) — تمييز فريد فقط.
 *  - الترتيب مصدره الوحيد orderQueue (queuePriority.ts): slotSeq لا يؤثر فيه إطلاقًا.
 */
import { describe, it, expect } from "vitest";
import { nextFollowUpSeq } from "../src/lib/slotAssign";
import { orderQueue, followUpAnchorFor, FOLLOW_UP_ANCHOR_NONE } from "../src/lib/queuePriority";

describe("nextFollowUpSeq", () => {
  it("وقت شاغر → 0", () => expect(nextFollowUpSeq([])).toBe(0));
  it("وقت مشغول بموعد عادي → 1", () => expect(nextFollowUpSeq([{ slotSeq: 0 }])).toBe(1));
  it("عدة متابعات في نفس الدقيقة → قيم متتالية فريدة", () => {
    const rows = [{ slotSeq: 0 }];
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) { const n = nextFollowUpSeq(rows); seen.push(n); rows.push({ slotSeq: n }); }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });
  it("لا يعيد استعمال قيمة قائمة حتى مع فجوات", () => expect(nextFollowUpSeq([{ slotSeq: 0 }, { slotSeq: 3 }])).toBe(4));
});

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, startTime: "10:00", status: "CONFIRMED", arrivedAt: new Date(), urgencyStatus: "NONE", isFollowUp: false, ...extra,
});

describe("الترتيب مصدره queuePriority وحده (slotSeq لا يدخله)", () => {
  it("متابعة حضرت أولًا (مرساة none) تسبق حجزًا عاديًا في نفس الدقيقة مهما كان المعرّف", () => {
    const rows = [row("a-regular"), row("z-follow", { isFollowUp: true, followUpAnchorId: FOLLOW_UP_ANCHOR_NONE, slotSeq: 1 })];
    expect(orderQueue(rows).map((r) => r.id)).toEqual(["z-follow", "a-regular"]);
  });
  it("متابعة تحضر والحجز العادي هو التالي المحمي: لا تتجاوزه (المرساة المحفوظة عند الحضور)", () => {
    const regular = row("a-regular");
    const follow = row("z-follow", { isFollowUp: true, slotSeq: 1 });
    const anchor = followUpAnchorFor([regular, follow], "z-follow");
    expect(anchor).toBe("a-regular");
    expect(orderQueue([regular, { ...follow, followUpAnchorId: anchor }]).map((r) => r.id)).toEqual(["a-regular", "z-follow"]);
  });
  it("قيمة slotSeq لا تغيّر الترتيب أبدًا", () => {
    const mk = (seq: number) => [row("a"), row("z", { isFollowUp: true, followUpAnchorId: FOLLOW_UP_ANCHOR_NONE, slotSeq: seq })];
    expect(orderQueue(mk(1)).map((r) => r.id)).toEqual(orderQueue(mk(7)).map((r) => r.id));
  });
  it("الحجز العادي غير الحاضر لا يعطّل الطابور", () => {
    const rows = [row("a-absent", { arrivedAt: null }), row("z-follow", { isFollowUp: true, followUpAnchorId: FOLLOW_UP_ANCHOR_NONE, slotSeq: 1 })];
    expect(orderQueue(rows)[0].id).toBe("z-follow");
  });
  it("متابعة مؤجلة (LATE/deferredCount) لا تحتفظ بالأولوية — منطق التأخير محفوظ", () => {
    const rows = [row("a"), row("z-follow", { isFollowUp: true, followUpAnchorId: FOLLOW_UP_ANCHOR_NONE, slotSeq: 1, deferredCount: 1 })];
    expect(orderQueue(rows).map((r) => r.id)).toEqual(["a", "z-follow"]);
  });
});
