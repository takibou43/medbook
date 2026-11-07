import { API_URL } from "./api";

/**
 * يرسل أخطاء المتصفح غير المعالجة إلى الخادم (/client-errors) ليُعرف العطل قبل أن يبلّغ عنه الطبيب أو المريض.
 * لا يرسل بيانات المريض: المسار دون الاستعلام، ونص الخطأ مقصوص، والخادم يخفي الأرقام والبريد مرة أخرى.
 * حد أقصى 5 تقارير لكل فتح صفحة، ولا يكرر التقرير نفسه.
 */
const PORTAL = "patient" as const;
const MAX_REPORTS = 5;

type Report = { kind: "error" | "unhandledrejection" | "chunk"; message: string; source?: string; line?: number; column?: number; stack?: string };

export function isChunkLoadError(message: string): boolean {
  return /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(message);
}

function stripQuery(value: string | undefined): string | undefined {
  return value?.replace(/[?#].*$/, "").slice(0, 300);
}

export function installClientErrorReporter(endpoint = API_URL + "/client-errors"): () => void {
  if (typeof window === "undefined") return () => {};
  const seen = new Set<string>();
  let sent = 0;

  function send(report: Report) {
    const message = (report.message || "unknown").slice(0, 500);
    const key = report.kind + "|" + message + "|" + (report.source ?? "") + "|" + (report.line ?? "");
    if (sent >= MAX_REPORTS || seen.has(key)) return;
    seen.add(key);
    sent += 1;
    const body = JSON.stringify({
      portal: PORTAL,
      kind: report.kind === "error" && isChunkLoadError(message) ? "chunk" : report.kind,
      message,
      source: stripQuery(report.source),
      path: stripQuery(window.location.pathname),
      line: report.line,
      column: report.column,
      stack: report.stack?.slice(0, 2000),
    });
    try {
      void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "omit" }).catch(() => {});
    } catch { /* لا يجوز أن يتسبب التبليغ نفسه في خطأ */ }
  }

  function onError(event: ErrorEvent) {
    const err = event.error as Error | undefined;
    send({ kind: "error", message: event.message || err?.message || "", source: event.filename, line: event.lineno, column: event.colno, stack: err?.stack });
  }

  function onRejection(event: PromiseRejectionEvent) {
    const reason = event.reason as { message?: unknown; stack?: unknown; isAxiosError?: boolean } | undefined;
    // أخطاء الشبكة والردود 4xx/5xx تُعالَج وتُسجَّل في الخادم أصلًا؛ لا نكررها هنا.
    if (reason?.isAxiosError) return;
    const message = typeof reason?.message === "string" ? reason.message : String(event.reason ?? "");
    send({ kind: isChunkLoadError(message) ? "chunk" : "unhandledrejection", message, stack: typeof reason?.stack === "string" ? reason.stack : undefined });
  }

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
