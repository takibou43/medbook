import { describe, expect, it } from "vitest";
import { firstPresent, presentQueueOrder } from "../src/lib/presentQueue";
import { FOLLOW_UP_ANCHOR_NONE, followUpAnchorFor, isPriorityFollowUp, orderQueue } from "../src/lib/queuePriority";

/**
 * أولوية موعد العودة الطبي في الطابور — دالة الترتيب المركزية (lib/queuePriority.ts) المشتركة بين
 * عرض الطابور والمناداة وحساب الدور والتذكيرات. تُختبر هنا نقية بلا قاعدة بيانات.
 */
const at = new Date("2026-10-11T08:00:00Z");
type Row = { id: string; startTime: string; status: string; arrivedAt: Date | null; urgencyStatus?: string; isFollowUp?: boolean; deferredCount?: number; skipCredits?: number; nearTurnNotified?: boolean; followUpAnchorId?: string | null };
const row = (id: string, startTime: string, o: Partial<Row> = {}): Row => ({ id, startTime, status: "CONFIRMED", arrivedAt: at, urgencyStatus: "NONE", isFollowUp: false, deferredCount: 0, skipCredits: 0, nearTurnNotified: false, ...o });
const f = (id: string, startTime: string, anchor: string | null | undefined, o: Partial<Row> = {}) => row(id, startTime, { isFollowUp: true, followUpAnchorId: anchor, ...o });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("ترتيب الطابور بدون موعد عودة (السلوك السابق كما هو)", () => {
  it("الحاضرون أولًا ثم الطوارئ المعتمدة ثم وقت الموعد ثم المعرّف", () => {
    const rows = [row("c", "10:00", { arrivedAt: null }), row("b", "09:30"), row("a", "09:00", { arrivedAt: null }), row("u", "11:00", { urgencyStatus: "APPROVED" }), row("d", "09:30")];
    expect(ids(orderQueue(rows))).toEqual(["u", "b", "d", "a", "c"]);
  });
  it("presentQueueOrder هو نفسه الدالة المركزية", () => {
    const rows = [row("f", "10:00", { isFollowUp: true }), row("p1", "08:00"), row("p2", "08:20")];
    expect(ids(presentQueueOrder(rows))).toEqual(ids(orderQueue(rows)));
  });
  it("لا يعدّل المصفوفة الأصلية", () => {
    const rows = [row("b", "09:30"), row("a", "09:00")];
    const copy = [...rows];
    orderQueue(rows);
    expect(rows).toEqual(copy);
  });
});

describe("أولوية موعد العودة (مع مرساة الحماية المحفوظة عند الحضور)", () => {
  it("1) يتقدم على الحاضرين لكنه لا يتجاوز المريض التالي مباشرة (المرساة)", () => {
    const rows = [row("n1", "09:00"), row("n2", "09:20"), row("n3", "09:40"), f("f", "11:00", "n1")];
    expect(ids(orderQueue(rows))).toEqual(["n1", "f", "n2", "n3"]);
  });
  it("1ب) تقدّم الطابور: بعد مناداة صاحب المرساة يصير موعد العودة هو التالي (لا يتراجع كل مرة)", () => {
    const rows = [row("n2", "09:20"), row("n3", "09:40"), f("f", "11:00", "n1")];
    expect(ids(orderQueue(rows))).toEqual(["f", "n2", "n3"]);
  });
  it("1ج) حضر ولا أحد غيره محمي (مرساة none): هو الأول وغيره لاحقًا لا يتقدم عليه", () => {
    const rows = [row("n1", "09:00"), f("f", "11:00", FOLLOW_UP_ANCHOR_NONE)];
    expect(ids(orderQueue(rows))).toEqual(["f", "n1"]);
  });
  it("1د) سجل قديم بلا مرساة محفوظة: يُحمى التالي مباشرة ديناميكيًا (احتياط محافظ)", () => {
    const rows = [row("n1", "09:00"), row("n2", "09:20"), f("f", "11:00", null)];
    expect(ids(orderQueue(rows))).toEqual(["n1", "f", "n2"]);
  });
  it("2) موعد عودة غير حاضر لا يتقدم ولا يؤثر في غيره", () => {
    const rows = [row("n1", "09:00"), row("n2", "09:20"), f("f", "11:00", "n1", { arrivedAt: null })];
    expect(ids(orderQueue(rows))).toEqual(["n1", "n2", "f"]);
  });
  it("3) لا يتجاوز مريضًا أُرسل له تنبيه «دورك اقترب» ولو بعد مرساته", () => {
    const rows = [row("n1", "09:00"), row("n2", "09:20"), row("n3", "09:40", { nearTurnNotified: true }), row("n4", "10:00"), f("f", "11:00", "n1")];
    expect(ids(orderQueue(rows))).toEqual(["n1", "n2", "n3", "f", "n4"]);
  });
  it("3ب) المنبَّه يبقى محميًا حتى لو غابت المرساة", () => {
    const rows = [row("n2", "09:20"), row("n3", "09:40", { nearTurnNotified: true }), row("n4", "10:00"), f("f", "11:00", "n1")];
    expect(ids(orderQueue(rows))).toEqual(["n2", "n3", "f", "n4"]);
  });
  it("4) الطوارئ المعتمدة تبقى أمامه دائمًا", () => {
    const rows = [row("n1", "09:00"), row("u", "12:00", { urgencyStatus: "APPROVED" }), row("n2", "09:20"), f("f", "11:00", "n1")];
    const order = ids(orderQueue(rows));
    expect(order[0]).toBe("u");
    expect(order.indexOf("u")).toBeLessThan(order.indexOf("f"));
    expect(order.indexOf("n1")).toBeLessThan(order.indexOf("f"));
  });
  it("5) موعد عودة بحالة LATE أو سبق تأجيله لا يحصل على أولوية (العقوبات باقية)", () => {
    const base = [row("n1", "09:00"), row("n2", "09:20"), row("n3", "09:40")];
    for (const o of [{ status: "LATE" }, { deferredCount: 1 }, { skipCredits: 2 }]) {
      const late = f("f", "11:00", FOLLOW_UP_ANCHOR_NONE, o);
      expect(isPriorityFollowUp(late)).toBe(false);
      expect(ids(orderQueue([...base, late]))).toEqual(["n1", "n2", "n3", "f"]);
    }
  });
  it("6) موعدا عودة حاضران يتقدمان بترتيب وقتيهما بعد المحميين", () => {
    const rows = [row("n1", "09:00"), row("n2", "09:20"), f("f2", "12:00", "n1"), f("f1", "11:00", "n1")];
    expect(ids(orderQueue(rows))).toEqual(["n1", "f1", "f2", "n2"]);
  });
  it("7) الأولوية لا تؤخر موعد العودة عن موضعه الطبيعي بوقت موعده", () => {
    const rows = [row("n1", "09:00"), f("f", "09:10", "n1"), row("n2", "09:20"), row("n3", "09:40", { nearTurnNotified: true })];
    expect(ids(orderQueue(rows))).toEqual(["n1", "f", "n2", "n3"]);
  });
  it("8) موعد عودة حضر بعد أن صار آخرون محميين يُدرج في أول موضع مؤهل دون إعادة ترتيبهم", () => {
    const before = [row("n1", "09:00"), row("n2", "09:20", { nearTurnNotified: true }), row("n3", "09:40", { nearTurnNotified: true }), row("n4", "10:00")];
    const anchor = followUpAnchorFor(before, "f");
    expect(anchor).toBe("n3");
    const order = ids(orderQueue([...before, f("f", "11:00", anchor)]));
    expect(order).toEqual(["n1", "n2", "n3", "f", "n4"]);
    expect(order.filter((i) => i !== "f")).toEqual(ids(orderQueue(before)));
  });
  it("9) المريض الأول لا يُمسّ حتى لو وحده حاضر مع موعد عودة", () => {
    expect(ids(orderQueue([row("n1", "09:00"), f("f", "11:00", "n1")]))).toEqual(["n1", "f"]);
  });
  it("10) موعد العودة الوحيد الحاضر يُنادى أولًا إذا لم يكن أحد غيره حاضرًا", () => {
    expect(ids(orderQueue([row("a", "09:00", { arrivedAt: null }), f("f", "11:00", FOLLOW_UP_ANCHOR_NONE)]))).toEqual(["f", "a"]);
  });
  it("11) موعد عودة ثانٍ يحضر بعد الأول: لا يتجاوز الأول ولا مرساته", () => {
    const rows = [row("n1", "09:00"), row("n2", "09:20"), f("f1", "11:00", "n1"), f("f2", "10:00", "f1")];
    const order = ids(orderQueue(rows));
    expect(order.indexOf("n1")).toBeLessThan(order.indexOf("f1"));
    expect(order.indexOf("f1")).toBeLessThan(order.indexOf("f2"));
    expect(order.indexOf("f2")).toBeLessThan(order.indexOf("n2"));
  });
});

describe("followUpAnchorFor (المرساة المحفوظة لحظة الحضور)", () => {
  it("لا أحد حاضر ⇒ none", () => {
    expect(followUpAnchorFor([], "f")).toBe(FOLLOW_UP_ANCHOR_NONE);
    expect(followUpAnchorFor([row("a", "09:00", { arrivedAt: null })], "f")).toBe(FOLLOW_UP_ANCHOR_NONE);
  });
  it("آخر محمي: التالي مباشرة إن لم ينبَّه أحد", () => {
    expect(followUpAnchorFor([row("n1", "09:00"), row("n2", "09:20")], "f")).toBe("n1");
  });
  it("يستثني الموعد نفسه، ويحتسب الطوارئ المعتمدة ومن نُبِّه", () => {
    const rows = [row("n1", "09:00"), row("n2", "09:20", { nearTurnNotified: true }), row("u", "13:00", { urgencyStatus: "APPROVED" }), row("f", "10:00", { isFollowUp: true })];
    expect(followUpAnchorFor(rows, "f")).toBe("n2");
  });
});

describe("المناداة (firstPresent) تتبع الترتيب نفسه", () => {
  it("لا تنادي موعد العودة قبل المريض التالي المحمي", () => {
    const rows = [row("n1", "09:00"), row("n2", "09:20"), f("f", "11:00", "n1")];
    expect(firstPresent(rows)?.id).toBe("n1");
  });
  it("بعد مناداة صاحب المرساة تنادي موعد العودة (تقدّم حقيقي)", () => {
    expect(firstPresent([row("n2", "09:20"), f("f", "11:00", "n1")])?.id).toBe("f");
  });
  it("تنادي موعد العودة إن كان الحاضر الوحيد", () => {
    expect(firstPresent([row("a", "09:00", { arrivedAt: null }), f("f", "11:00", FOLLOW_UP_ANCHOR_NONE)])?.id).toBe("f");
  });
  it("تتجاهل من ليسوا CONFIRMED/LATE أو غير الحاضرين", () => {
    expect(firstPresent([row("x", "09:00", { status: "COMPLETED" }), row("y", "09:10", { arrivedAt: null })])).toBeNull();
  });
});
