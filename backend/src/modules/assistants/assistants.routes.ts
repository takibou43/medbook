import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { inviteAssistantSchema } from "./assistants.schema";
import * as service from "./assistants.service";

// إدارة المساعدين — الطبيب فقط. مثبَّتة على /api/doctor/assistants (انظر app.ts).
const router = Router();
router.use(authenticate, authorize(Role.DOCTOR));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.listAssistants(req.user!.id) });
  })
);

router.post(
  "/invite",
  validate({ body: inviteAssistantSchema }),
  asyncHandler(async (req, res) => {
    const { invite, rawToken } = await service.createInvite(req.user!.id, req.body.email);
    // الرمز الخام يظهر هنا مرة واحدة فقط في الاستجابة (غير مخزَّن)؛ الطبيب ينسخ الرابط ويرسله يدويًا.
    res.status(201).json({
      success: true,
      message: "تم إنشاء رابط الدعوة. انسخه وأرسله للمساعد.",
      data: { invite, token: rawToken },
    });
  })
);

router.post(
  "/invites/:id/resend",
  asyncHandler(async (req, res) => {
    const { invite, rawToken } = await service.resendInvite(req.user!.id, req.params.id);
    res.json({ success: true, message: "تم تجديد رابط الدعوة.", data: { invite, token: rawToken } });
  })
);

router.post(
  "/invites/:id/revoke",
  asyncHandler(async (req, res) => {
    const invite = await service.revokeInvite(req.user!.id, req.params.id);
    res.json({ success: true, message: "تم إلغاء الدعوة.", data: invite });
  })
);

const toggleSchema = z.object({ isActive: z.boolean() });

router.patch(
  "/:id/status",
  validate({ body: toggleSchema }),
  asyncHandler(async (req, res) => {
    const assistant = await service.setAssistantActive(req.user!.id, req.params.id, req.body.isActive);
    res.json({
      success: true,
      message: req.body.isActive ? "تم تفعيل وصول المساعد." : "تم تعطيل وصول المساعد.",
      data: assistant,
    });
  })
);

export default router;
