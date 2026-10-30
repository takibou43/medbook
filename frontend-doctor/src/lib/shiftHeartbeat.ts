import type { QueryClient } from "@tanstack/react-query";

/** Same shape as GET /shifts: POST /shifts/heartbeat returns the server's shiftState after extending it. */
export type ShiftState = {
  active: boolean;
  endsAt: string | null;
  suggestedEndTime?: string | null;
  hasActiveAssistant?: boolean;
};

export const shiftQueryKey = (userId: string) => ["shift", userId] as const;

export function isShiftState(value: unknown): value is ShiftState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.active === "boolean" && (v.endsAt === null || typeof v.endsAt === "string");
}

type ShiftCache = Pick<QueryClient, "cancelQueries" | "setQueryData" | "invalidateQueries">;

/**
 * نبضة المداومة (كل 20 ث) تُرجع حالة المداومة الحالية من الخادم بعد تمديدها. كانت الواجهة تتجاهل هذا الرد
 * ثم تطلب GET /shifts فورًا لجلب البيانات نفسها، أي طلبين وعدة استعلامات إضافية في قاعدة البيانات كل 20 ث
 * لكل طبيب في مداومته. نخزّن الرد مباشرة بدل ذلك. إن جاء رد بشكل غير متوقع نعود إلى إعادة الجلب كما كان.
 */
export async function applyHeartbeatResult(qc: ShiftCache, userId: string, body: unknown): Promise<void> {
  const key = shiftQueryKey(userId);
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!isShiftState(data)) {
    await qc.invalidateQueries({ queryKey: key });
    return;
  }
  // An older in-flight GET must not overwrite the fresher heartbeat state (invalidate used to cancel it too).
  await qc.cancelQueries({ queryKey: key });
  qc.setQueryData(key, data);
}
