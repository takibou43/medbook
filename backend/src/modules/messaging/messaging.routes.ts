import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./messaging.service";

// حدّ إرسال لكل مستخدم (وليس لكل IP): يمنع الإغراق دون أن يتأثر به من يشاركون شبكة واحدة.
const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `msg:${req.user?.id ?? "anon"}`,
  message: { success: false, message: "أرسلت رسائل كثيرة خلال وقت قصير. انتظر لحظات ثم أعد المحاولة." },
});

const sendBody = z.object({
  // الطول الفعلي تفرضه sanitizeMessageContent؛ هنا سقف صلب لحجم الحمولة فقط.
  content: z.string().max(10_000),
  clientId: z.string().uuid().optional(),
});
const listQuery = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
const doctorIdParams = z.object({ doctorId: z.string().uuid() });
const conversationsQuery = z.object({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(30),
});

// ============ الإدارة: /api/admin/messages (يُركَّب داخل router الإدارة المحمي بـ authorize(ADMIN)) ============
export const adminMessagesRouter = Router();
adminMessagesRouter.use(authenticate, authorize(Role.ADMIN));

adminMessagesRouter.get(
  "/conversations",
  validate({ query: conversationsQuery }),
  asyncHandler(async (req, res) => {
    const { q, page, pageSize } = req.query as any;
    res.json({ success: true, data: await service.listAdminConversations({ q, page, pageSize }) });
  })
);

adminMessagesRouter.get(
  "/unread-count",
  asyncHandler(async (_req, res) => res.json({ success: true, data: await service.adminUnreadSummary() }))
);

adminMessagesRouter.get(
  "/conversations/:doctorId/messages",
  validate({ params: doctorIdParams, query: listQuery }),
  asyncHandler(async (req, res) => {
    const { before, limit } = req.query as any;
    res.json({ success: true, data: await service.listMessages(req.params.doctorId, { before, limit }) });
  })
);

adminMessagesRouter.post(
  "/conversations/:doctorId/messages",
  sendLimiter,
  validate({ params: doctorIdParams, body: sendBody }),
  asyncHandler(async (req, res) => {
    // هوية المرسل من الجلسة فقط؛ أي senderId/senderRole في الجسم يُتجاهل (Zod يُسقط الحقول الزائدة).
    const { message, duplicate } = await service.sendMessage({
      doctorId: req.params.doctorId,
      sender: { id: req.user!.id, role: Role.ADMIN },
      content: req.body.content,
      clientId: req.body.clientId,
    });
    res.status(duplicate ? 200 : 201).json({ success: true, data: message, duplicate });
  })
);

adminMessagesRouter.patch(
  "/conversations/:doctorId/read",
  validate({ params: doctorIdParams }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.markRead(req.params.doctorId, { id: req.user!.id, role: Role.ADMIN }) });
  })
);

// ============ الطبيب: /api/doctor/messages (طبيب فقط — المساعد يُرفض 403) ============
export const doctorMessagesRouter = Router();
doctorMessagesRouter.use(authenticate, authorize(Role.DOCTOR));

doctorMessagesRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const doctor = await service.getDoctorForUser(req.user!.id);
    res.json({ success: true, data: await service.doctorUnreadSummary(doctor.id) });
  })
);

doctorMessagesRouter.get(
  "/",
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const doctor = await service.getDoctorForUser(req.user!.id);
    const { before, limit } = req.query as any;
    res.json({ success: true, data: await service.listMessages(doctor.id, { before, limit }) });
  })
);

doctorMessagesRouter.post(
  "/",
  sendLimiter,
  validate({ body: sendBody }),
  asyncHandler(async (req, res) => {
    const doctor = await service.getDoctorForUser(req.user!.id);
    const { message, duplicate } = await service.sendMessage({
      doctorId: doctor.id,
      sender: { id: req.user!.id, role: Role.DOCTOR },
      content: req.body.content,
      clientId: req.body.clientId,
    });
    res.status(duplicate ? 200 : 201).json({ success: true, data: message, duplicate });
  })
);

doctorMessagesRouter.patch(
  "/read",
  asyncHandler(async (req, res) => {
    const doctor = await service.getDoctorForUser(req.user!.id);
    res.json({ success: true, data: await service.markRead(doctor.id, { id: req.user!.id, role: Role.DOCTOR }) });
  })
);
