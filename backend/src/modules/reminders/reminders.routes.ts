import { Router, Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { env } from "../../config/env";
import { runReminderCycle } from "./reminders.service";

/**
 * POST /api/internal/reminders/run — تشغيل دورة تذكيرات يدويًا أو من مُجدوِل خارجي (cron).
 *
 * ليس عامًا: يتطلب الترويسة X-Cron-Secret مطابقة لـREMINDER_CRON_SECRET (متغير بيئة في الخادم فقط،
 * لا يصل إلى الواجهة أبدًا). إن لم يُضبط المتغير فالمسار معطّل كليًا (404) — لا وضع "مفتوح" افتراضيًا.
 * التشغيل آمن للتكرار: الحجز الذرّي في قاعدة البيانات يمنع أي إرسال مكرر.
 */
function safeEqual(a: string, b: string): boolean {
  // مقارنة بزمن ثابت على بصمتين بطول واحد، فلا يكشف التوقيت طول السر ولا أحرفه.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function requireCronSecret(req: Request, _res: Response, next: NextFunction) {
  const secret = env.reminders.cronSecret;
  if (!secret) return next(ApiError.notFound("المسار غير موجود."));
  const provided = req.get("x-cron-secret") ?? "";
  if (!provided || !safeEqual(provided, secret)) return next(ApiError.unauthorized());
  return next();
}

const router = Router();

router.post(
  "/reminders/run",
  requireCronSecret,
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await runReminderCycle();
    res.json({ success: true, data: stats });
  })
);

export default router;
