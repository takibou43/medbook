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

/** One request at a time; stale responses must not overwrite a newer GET or a cleared account. */
export function createShiftHeartbeatSender(
  qc: ShiftCache & Pick<QueryClient, "getQueryData">,
  userId: string,
  request: (signal: AbortSignal) => Promise<unknown>,
) {
  let stopped = false;
  let controller: AbortController | undefined;
  return {
    async send() {
      if (stopped || controller) return;
      const pending = new AbortController();
      controller = pending;
      const previous = qc.getQueryData(shiftQueryKey(userId));
      const current = () => !stopped && !pending.signal.aborted &&
        qc.getQueryData(shiftQueryKey(userId)) === previous;
      try {
        const body = await request(pending.signal);
        await applyHeartbeatResult(qc, userId, body, current);
      } catch {
        // Existing safety polling recovers transient errors; cleanup aborts are expected.
      } finally {
        controller = undefined;
      }
    },
    stop() { stopped = true; controller?.abort(); },
  };
}

/**
 * نبضة المداومة (كل 20 ث) تُرجع حالة المداومة الحالية من الخادم بعد تمديدها. كانت الواجهة تتجاهل هذا الرد
 * ثم تطلب GET /shifts فورًا لجلب البيانات نفسها، أي طلبين وعدة استعلامات إضافية في قاعدة البيانات كل 20 ث
 * لكل طبيب في مداومته. نخزّن الرد مباشرة بدل ذلك. إن جاء رد بشكل غير متوقع نعود إلى إعادة الجلب كما كان.
 */
export async function applyHeartbeatResult(qc: ShiftCache, userId: string, body: unknown, current = () => true): Promise<void> {
  if (!current()) return;
  const key = shiftQueryKey(userId);
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!isShiftState(data)) {
    await qc.invalidateQueries({ queryKey: key });
    return;
  }
  // An older in-flight GET must not overwrite the fresher heartbeat state (invalidate used to cancel it too).
  await qc.cancelQueries({ queryKey: key });
  if (!current()) return;
  qc.setQueryData(key, data);
}
