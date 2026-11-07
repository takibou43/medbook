import { API_URL } from "./api";
import { buildClientErrorPayload } from "./clientErrorPayload";

/**
 * يبلّغ الخادم بأخطاء المتصفح غير المعالجة، ببيانات تقنية محددة فقط (clientErrorPayload.ts):
 * فئة الخطأ، رمز تقني معروف، مسار مُعمّم بلا معرّفات، واسم ملف الحزمة. لا رسالة ولا مكدّس ولا استعلام.
 * حد أقصى 5 تقارير لكل فتح صفحة، دون تكرار التقرير نفسه.
 */
const PORTAL = "doctor" as const;
const MAX_REPORTS = 5;

export function installClientErrorReporter(endpoint = API_URL + "/client-errors"): () => void {
  if (typeof window === "undefined") return () => {};
  const seen = new Set<string>();
  let sent = 0;

  function send(payload: ReturnType<typeof buildClientErrorPayload>) {
    const body = JSON.stringify(payload);
    if (sent >= MAX_REPORTS || seen.has(body)) return;
    seen.add(body);
    sent += 1;
    try {
      void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "omit" }).catch(() => {});
    } catch { /* لا يجوز أن يتسبب التبليغ نفسه في خطأ */ }
  }

  const base = () => ({ portal: PORTAL, pathname: window.location.pathname, origin: window.location.origin });

  function onError(event: ErrorEvent) {
    send(buildClientErrorPayload({ ...base(), kind: "error", error: event.error, message: event.message, filename: event.filename, line: event.lineno, column: event.colno }));
  }

  function onRejection(event: PromiseRejectionEvent) {
    const reason = event.reason as { isAxiosError?: boolean } | undefined;
    // أخطاء الشبكة وردود 4xx/5xx معالَجة ومسجّلة في الخادم أصلًا.
    if (reason?.isAxiosError) return;
    send(buildClientErrorPayload({ ...base(), kind: "unhandledrejection", error: event.reason }));
  }

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
