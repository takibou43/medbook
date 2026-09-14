import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authLimiter } from "../../middleware/rateLimiter";
import * as service from "./assistants.service";

// مسار عام بدون مصادقة — تُستهلك من صفحة قبول الدعوة (/assistant/accept/:token في
// الواجهة) لعرض اسم الطبيب/العيادة قبل ملء نموذج التسجيل. لا يُرجع أي بيانات حساسة
// (لا بريد كامل غير الذي تحمله الدعوة نفسها، لا معرّفات داخلية).
// نطبّق authLimiter هنا أيضًا (نفس حدّ محاولات auth) لمنع تخمين الرموز بالقوة الغاشمة.
const router = Router();

router.get(
  "/invite/:token",
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = await service.getInviteByToken(req.params.token);
    res.json({ success: true, data });
  })
);

export default router;
