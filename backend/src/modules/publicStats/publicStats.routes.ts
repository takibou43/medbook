import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPublicBookingStats } from "./publicStats.service";

/**
 * /api/public/stats — إحصائيات عامة بلا مصادقة ولا أي بيانات شخصية.
 * محدود المعدل (60 طلبًا في الدقيقة لكل عنوان) فوق الحد العام للـAPI، ومخزّن مؤقتًا 5 دقائق لدى المتصفح/الوسيط.
 */
const router = Router();

export const publicStatsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "عدد كبير من الطلبات. الرجاء المحاولة لاحقًا." },
});

const bookingsQuerySchema = z
  .object({ wilayaId: z.string().uuid("ولاية غير صالحة").optional() })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

router.get(
  "/bookings",
  publicStatsLimiter,
  validate({ query: bookingsQuerySchema }),
  asyncHandler(async (req, res) => {
    const data = await getPublicBookingStats((req.query.wilayaId as string | undefined) ?? null);
    res.set("Cache-Control", "public, max-age=300");
    res.json({ success: true, data });
  })
);

export default router;
