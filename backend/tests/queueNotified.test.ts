import { describe, expect, it, vi } from "vitest";
import { withNearTurnFlags, NEAR_TURN_PROTECTED_STATUSES } from "../src/lib/queueNotified";

/** حالة التنبيه المحفوظة (AppointmentReminder QUEUE_APPROACH) هي مصدر الحماية — لا افتراض وصول أو قراءة. */
const db = (rows: { appointmentId: string }[]) => ({ appointmentReminder: { findMany: vi.fn(async () => rows) } });

describe("withNearTurnFlags", () => {
  it("يعلّم فقط المواعيد التي لها سجل «دورك اقترب» أُرسل أو قيد الإرسال", async () => {
    const d = db([{ appointmentId: "b" }]);
    const out = await withNearTurnFlags(d as never, [{ id: "a" }, { id: "b" }]);
    expect(out).toEqual([{ id: "a", nearTurnNotified: false }, { id: "b", nearTurnNotified: true }]);
    const where = (d.appointmentReminder.findMany.mock.calls[0] as unknown as [{ where: { type: string; status: { in: string[] }; appointmentId: { in: string[] } } }])[0].where;
    expect(where.type).toBe("QUEUE_APPROACH");
    expect(where.appointmentId.in).toEqual(["a", "b"]);
    expect(where.status.in).toEqual(NEAR_TURN_PROTECTED_STATUSES);
  });
  it("SENT وPROCESSING فقط محميان؛ PENDING وSKIPPED وFAILED ليست إشعارًا وصل", () => {
    expect([...NEAR_TURN_PROTECTED_STATUSES].sort()).toEqual(["PROCESSING", "SENT"]);
  });
  it("قائمة فارغة لا تستعلم القاعدة", async () => {
    const d = db([]);
    expect(await withNearTurnFlags(d as never, [])).toEqual([]);
    expect(d.appointmentReminder.findMany).not.toHaveBeenCalled();
  });
});
