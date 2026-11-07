import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireTrustedOrigin } from "../../middleware/originGuard";
import { validate } from "../../middleware/validate";

/**
 * استقبال أخطاء المتصفح من موقعي المرضى والأطباء، وكتابتها سطرًا واحدًا في سجلات Render.
 * - لا قاعدة بيانات ولا خدمة خارجية ولا حزمة جديدة.
 * - لا بيانات مرضى: تُحذف أجزاء الاستعلام من الروابط، وتُخفى الأرقام الطويلة (هواتف) والبريد.
 * - مسار عام لأن الخطأ قد يقع قبل تسجيل الدخول؛ محمي بالأصل الموثوق وحد معدل صغير.
 */
export const CLIENT_ERROR_LIMIT = 20;
const clientErrorLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: CLIENT_ERROR_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "طلبات كثيرة." },
});

const schema = z.object({
  portal: z.enum(["patient", "doctor"]),
  kind: z.enum(["error", "unhandledrejection", "chunk"]),
  message: z.string().max(500),
  source: z.string().max(300).optional(),
  path: z.string().max(300).optional(),
  line: z.number().int().min(0).max(10_000_000).optional(),
  column: z.number().int().min(0).max(10_000_000).optional(),
  stack: z.string().max(2000).optional(),
}).strict();

/** يُزيل ما قد يحمل بيانات شخصية: الاستعلام في الروابط، البريد، الأرقام الطويلة، والمعرّفات. */
export function scrubClientText(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/[?#][^\s)'"]*/g, "")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[num]")
    .replace(/[\r\n]+/g, " | ")
    .slice(0, max);
}

const router = Router();
router.post("/", requireTrustedOrigin, clientErrorLimiter, validate({ body: schema }), (req, res) => {
  const b = req.body as z.infer<typeof schema>;
  const entry = {
    portal: b.portal,
    kind: b.kind,
    message: scrubClientText(b.message, 300),
    source: scrubClientText(b.source, 200),
    path: scrubClientText(b.path, 200),
    line: b.line,
    column: b.column,
    stack: scrubClientText(b.stack, 1200),
  };
  console.warn("[client-error]", JSON.stringify(entry));
  res.status(204).end();
});

export default router;
