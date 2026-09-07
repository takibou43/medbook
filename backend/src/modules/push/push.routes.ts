import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../lib/prisma";
import { getPublicKey, isPushEnabled } from "../../lib/push";

const router = Router();

// المفتاح العام غير سرّي وتحتاجه الواجهة قبل إنشاء الاشتراك، لذلك لا يتطلب تسجيل دخول.
// enabled يخبر الواجهة مباشرة إن كانت الميزة مفعّلة على الخادم فتخفي الزر بدل إظهار خطأ لاحقًا.
router.get(
  "/public-key",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: { publicKey: getPublicKey(), enabled: isPushEnabled() } });
  })
);

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// إنشاء أو تحديث اشتراك هذا الجهاز. نستعمل upsert لأن المتصفح قد يعيد إرسال نفس
// endpoint بعد تجديد المفاتيح، فلا نريد سجلات مكررة ولا خطأ تعارض.
router.post(
  "/subscribe",
  authenticate,
  validate({ body: subscribeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { endpoint, keys } = req.body as z.infer<typeof subscribeSchema>;
    const userAgent = req.get("user-agent") ?? null;

    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: req.user!.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
      update: { userId: req.user!.id, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    });

    res.status(201).json({ success: true, data: { id: sub.id } });
  })
);

// إلغاء اشتراك هذا الجهاز فقط (مقيّد بصاحب الحساب حتى لا يلغي أحد اشتراك غيره).
router.post(
  "/unsubscribe",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const endpoint = (req.body as { endpoint?: string })?.endpoint;
    if (endpoint) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.id } });
    }
    res.json({ success: true, data: { removed: true } });
  })
);

export default router;
