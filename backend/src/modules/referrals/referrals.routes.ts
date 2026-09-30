import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./referrals.service";

/**
 * /api/doctor/referrals
 *  - GET  /me             طبيب فقط: كوده وإحالاته.
 *  - POST /validate-code  عام (قبل التسجيل): صالح/غير صالح فقط، محدود المعدل بصرامة ضد تخمين الأكواد.
 * يُسجَّل في app.ts قبل "/api/doctor" العام.
 */
const router = Router();

const validateCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "محاولات كثيرة. الرجاء المحاولة بعد قليل." },
});

router.get(
  "/me",
  authenticate,
  authorize(Role.DOCTOR),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.getMyReferrals(req.user!.id) });
  })
);

const validateCodeSchema = z.object({ code: z.string().trim().min(1, "أدخل كود الإحالة").max(20) }).strict("يحتوي الطلب على حقول غير مسموح بها.");

router.post(
  "/validate-code",
  validateCodeLimiter,
  validate({ body: validateCodeSchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.validateReferralCode(req.body.code) });
  })
);

export default router;
