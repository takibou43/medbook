import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireTrustedOrigin } from "../../middleware/originGuard";
import { validate } from "../../middleware/validate";

/**
 * استقبال أخطاء المتصفح من موقعي المرضى والأطباء، وكتابتها سطرًا واحدًا في سجلات Render.
 *
 * الخصوصية: لا يُقبل أي نص حر. كل حقل قيمة من قائمة محددة (فئة الخطأ، رمز تقني، أجزاء مسار معروفة،
 * اسم ملف حزمة Vite) أو رقم. رسالة الخطأ والمكدّس والاستعلام مرفوضة (المخطط strict)، فلا يمكن أن يصل
 * إلى السجل اسم مريض أو تشخيص أو توكن. القوائم نفسها في frontend/src/lib/clientErrorPayload.ts وfrontend-doctor/src/lib/clientErrorPayload.ts.
 *
 * الحماية (ليست مصادقة): المسار عام لأن الخطأ قد يقع قبل تسجيل الدخول.
 * - requireTrustedOrigin يرفض أصول المتصفح الأجنبية فقط؛ الطلب بلا Origin (curl) يمرّ.
 * - لذلك الحد الفعلي هو: 20 تقريرًا/10 دقائق لكل IP، و300/10 دقائق لكل الخادم، وجسم صغير بقيم محددة،
 *   بلا قاعدة بيانات. أسوأ إساءة ممكنة: أسطر سجل مزيفة من القيم المسموحة، محدودة العدد.
 */
export const CLIENT_ERROR_LIMIT = 20;
export const CLIENT_ERROR_GLOBAL_LIMIT = 300;

export const ERROR_CATEGORIES = [
  "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError", "AggregateError",
  "NetworkError", "ChunkLoadError", "SecurityError", "QuotaExceededError", "AbortError", "NotAllowedError", "Other",
] as const;
export const ERROR_CODES = ["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT", "ERR_CANCELED", "ERR_BAD_RESPONSE", "ERR_BAD_REQUEST", "CHUNK_LOAD"] as const;
export const ROUTE_SEGMENTS = [
  "account", "accept", "admin", "apply", "appointments", "arrival", "assistant", "assistants", "clinic", "clinics",
  "doctor", "doctors", "family", "keyboard-check", "login", "maintenance", "messages", "overview", "patient-blocks",
  "patients", "profile", "referrals", "register", "reviews", "schedule", "settings", "specialties", "status",
  "subscription", "treatment-plans", "users", "wilayas",
] as const;
const SEGMENTS = new Set<string>([...ROUTE_SEGMENTS, ":param"]);
const ASSET_PATTERN = /^[A-Za-z0-9_]{1,40}-[A-Za-z0-9_-]{8}\.js$/;

export function isGeneralizedRoute(route: string): boolean {
  if (route === "/") return true;
  if (!route.startsWith("/") || route.length > 120) return false;
  const parts = route.slice(1).split("/");
  return parts.length <= 6 && parts.every((p) => SEGMENTS.has(p));
}

const position = z.number().int().min(0).max(10_000_000).optional();
export const clientErrorSchema = z.object({
  portal: z.enum(["patient", "doctor"]),
  kind: z.enum(["error", "unhandledrejection", "chunk"]),
  category: z.enum(ERROR_CATEGORIES),
  code: z.enum(ERROR_CODES).optional(),
  route: z.string().max(120).refine(isGeneralizedRoute, "route must be generalized"),
  asset: z.string().max(60).regex(ASSET_PATTERN).optional(),
  line: position,
  column: position,
}).strict();

const limitMessage = { success: false, message: "طلبات كثيرة." };
const perIpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: CLIENT_ERROR_LIMIT, standardHeaders: true, legacyHeaders: false, message: limitMessage });
const globalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: CLIENT_ERROR_GLOBAL_LIMIT, standardHeaders: false, legacyHeaders: false,
  keyGenerator: () => "all-clients", message: limitMessage,
});

const router = Router();
router.post("/", requireTrustedOrigin, perIpLimiter, globalLimiter, validate({ body: clientErrorSchema }), (req, res) => {
  const b = req.body as z.infer<typeof clientErrorSchema>;
  // إعادة بناء صريحة للحقول المسموحة فقط (لا نمرر req.body كما هو).
  const entry = { portal: b.portal, kind: b.kind, category: b.category, code: b.code, route: b.route, asset: b.asset, line: b.line, column: b.column };
  console.warn("[client-error]", JSON.stringify(entry));
  res.status(204).end();
});

export default router;
