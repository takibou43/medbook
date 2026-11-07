/**
 * يحوّل خطأ المتصفح إلى بيانات تقنية محددة مسبقًا فقط، قبل أي إرسال.
 * لا يُرسل نص رسالة الخطأ ولا مكدّس الاستدعاء ولا الاستعلام أبدًا: قد يحويان اسم مريض أو تشخيصًا أو توكنًا
 * لا تكشفه أي أنماط إخفاء. الخادم يعيد التحقق من القوائم نفسها (clientErrors.routes.ts).
 * أي تعديل هنا يجب أن يطابق القوائم في الخادم وفي الواجهة الأخرى.
 */
export const ERROR_CATEGORIES = [
  "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError", "AggregateError",
  "NetworkError", "ChunkLoadError", "SecurityError", "QuotaExceededError", "AbortError", "NotAllowedError", "Other",
] as const;
export const ERROR_CODES = [
  "ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT", "ERR_CANCELED", "ERR_BAD_RESPONSE", "ERR_BAD_REQUEST", "CHUNK_LOAD",
] as const;
/** الأجزاء الثابتة في مسارات الموقعين؛ أي جزء آخر (معرّف، توكن، اسم) يصير :param. */
export const ROUTE_SEGMENTS = [
  "account", "accept", "admin", "apply", "appointments", "arrival", "assistant", "assistants", "clinic", "clinics",
  "doctor", "doctors", "family", "keyboard-check", "login", "maintenance", "messages", "overview", "patient-blocks",
  "patients", "profile", "referrals", "register", "reviews", "schedule", "settings", "specialties", "status",
  "subscription", "treatment-plans", "users", "wilayas",
] as const;
const SEGMENTS = new Set<string>(ROUTE_SEGMENTS);
const MAX_SEGMENTS = 6;
/** ملف حزمة Vite: name-hash.js (هاش من 8 محارف). */
export const ASSET_PATTERN = /^[A-Za-z0-9_]{1,40}-[A-Za-z0-9_-]{8}\.js$/;

export type ErrorKind = "error" | "unhandledrejection" | "chunk";
export type ClientErrorPayload = {
  portal: "patient" | "doctor";
  kind: ErrorKind;
  category: (typeof ERROR_CATEGORIES)[number];
  code?: (typeof ERROR_CODES)[number];
  route: string;
  asset?: string;
  line?: number;
  column?: number;
};

export function generalizeRoute(pathname: string): string {
  const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean).slice(0, MAX_SEGMENTS);
  return "/" + parts.map((p) => (SEGMENTS.has(p) ? p : ":param")).join("/");
}

export function safeAsset(fileUrl: string | undefined, origin: string): string | undefined {
  if (!fileUrl) return undefined;
  try {
    const url = new URL(fileUrl, origin);
    if (url.origin !== origin) return undefined;
    const base = url.pathname.split("/").pop() ?? "";
    return ASSET_PATTERN.test(base) ? base : undefined;
  } catch {
    return undefined;
  }
}

export function isChunkLoadError(message: string): boolean {
  return /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(message);
}

function categoryOf(err: unknown, chunk: boolean): ClientErrorPayload["category"] {
  if (chunk) return "ChunkLoadError";
  const name = typeof (err as { name?: unknown })?.name === "string" ? (err as { name: string }).name : "";
  return (ERROR_CATEGORIES as readonly string[]).includes(name) ? (name as ClientErrorPayload["category"]) : "Other";
}

function codeOf(err: unknown, chunk: boolean): ClientErrorPayload["code"] {
  if (chunk) return "CHUNK_LOAD";
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code) ? (code as ClientErrorPayload["code"]) : undefined;
}

function position(n: unknown): number | undefined {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10_000_000 ? n : undefined;
}

/** يبني الحمولة من خطأ؛ نص الرسالة يُقرأ محليًا فقط لتمييز فشل تحميل جزء من الموقع، ولا يُرسل. */
export function buildClientErrorPayload(input: {
  portal: ClientErrorPayload["portal"];
  kind: "error" | "unhandledrejection";
  error: unknown;
  message?: string;
  filename?: string;
  line?: number;
  column?: number;
  pathname: string;
  origin: string;
}): ClientErrorPayload {
  const rawMessage = input.message ?? (typeof (input.error as { message?: unknown })?.message === "string" ? (input.error as { message: string }).message : "");
  const chunk = isChunkLoadError(rawMessage);
  const asset = safeAsset(input.filename, input.origin);
  return {
    portal: input.portal,
    kind: chunk ? "chunk" : input.kind,
    category: categoryOf(input.error, chunk),
    ...(codeOf(input.error, chunk) ? { code: codeOf(input.error, chunk) } : {}),
    route: generalizeRoute(input.pathname),
    ...(asset ? { asset, line: position(input.line), column: position(input.column) } : {}),
  };
}
