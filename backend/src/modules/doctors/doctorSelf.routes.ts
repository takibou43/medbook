import { Router } from "express";
import { z } from "zod";
import { profileSchema } from "./doctorProfile.schema";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { Role } from "@prisma/client";
import * as service from "./doctorSelf.service";
import * as reviewsService from "../reviews/reviews.service";

const router = Router();
router.use(authenticate);

// لوحة التحكم متاحة للطبيب والمساعد معًا — الفلترة حسب الدور تتم داخل الخدمة نفسها
// (getDashboardStats) التي تحذف الحقول المالية غير المسموحة من جسم الاستجابة كليًا
// قبل إرسالها، لا فقط إخفاءها في الواجهة.
router.get(
  "/dashboard",
  authorize(Role.DOCTOR, Role.ASSISTANT),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.getDashboardStats(req.user!.id, req.user!.role) });
  })
);

// شروطي في العيادة (سعر موعدي ونسبتي) — طبيب فقط ولنفسه فقط؛ المساعد مستبعد. للقراءة: التعديل لمدير العيادة وحده.
router.get(
  "/clinic-terms",
  authorize(Role.DOCTOR),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.getOwnClinicTerms(req.user!.id) });
  })
);

// "مرضاي" — طبيب فقط (غير متاحة للمساعد، حسب الصلاحيات المتفق عليها).
// بحث/فرز/تقسيم صفحات من الخادم. بلا page تُرجَع المصفوفة كاملة كما سابقًا (توافق مع الواجهة القديمة).
const patientsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["recent", "next", "name"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

router.get(
  "/patients",
  authorize(Role.DOCTOR),
  validate({ query: patientsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof patientsQuerySchema>;
    res.json({ success: true, data: await service.getOwnPatients(req.user!.id, { ...query, paged: query.page !== undefined }) });
  })
);

// كل ما يلي (الملف المهني، أوقات العمل والاستثناءات) — طبيب فقط.
router.use(authorize(Role.DOCTOR));

// تقييمات المرضى للطبيب الحالي (طبيب فقط): متوسط، عدد، توزيع النجوم، والتقييمات مع التعليقات.
// قراءة فقط — لا يوجد أي مسار تعديل أو حذف للطبيب؛ doctorId من الجلسة وحدها.
router.get(
  "/reviews",
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json({ success: true, data: await reviewsService.listForCurrentDoctor(req.user!.id, req.user!.role, page, pageSize) });
  })
);



router.patch(
  "/profile",
  validate({ body: profileSchema }),
  asyncHandler(async (req, res) => {
    const updated = await service.updateOwnProfile(req.user!.id, req.body);
    res.json({ success: true, data: updated });
  })
);

router.get(
  "/schedule",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.getWeeklySchedule(req.user!.id) });
  })
);

const weeklyScheduleSchema = z.object({
  blocks: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
    })
  ),
  confirmAffected: z.boolean().optional().default(false),
});

router.put(
  "/schedule",
  validate({ body: weeklyScheduleSchema }),
  asyncHandler(async (req, res) => {
    const updated = await service.replaceWeeklySchedule(req.user!.id, req.body.blocks, req.body.confirmAffected);
    res.json({ success: true, data: updated });
  })
);

const exceptionSchema = z.object({
  exceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isOff: z.boolean(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  confirmAffected: z.boolean().optional().default(false),
});

router.post(
  "/schedule/exceptions",
  validate({ body: exceptionSchema }),
  asyncHandler(async (req, res) => {
    const created = await service.addScheduleException(req.user!.id, req.body, req.body.confirmAffected);
    res.status(201).json({ success: true, data: created });
  })
);

router.delete(
  "/schedule/:blockId",
  asyncHandler(async (req, res) => {
    await service.removeScheduleBlock(req.user!.id, req.params.blockId);
    res.json({ success: true, message: "تم الحذف." });
  })
);

export default router;
