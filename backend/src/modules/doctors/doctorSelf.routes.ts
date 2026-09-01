import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { Role } from "@prisma/client";
import * as service from "./doctorSelf.service";

const router = Router();
router.use(authenticate, authorize(Role.DOCTOR));

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.getDashboardStats(req.user!.id) });
  })
);

router.get(
  "/patients",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.getOwnPatients(req.user!.id) });
  })
);

const profileSchema = z.object({
  bio: z.string().optional(),
  yearsExperience: z.coerce.number().int().min(0).optional(),
  languages: z.array(z.string()).optional(),
  consultationFee: z.coerce.number().int().min(0).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  photoUrl: z.string().url().optional(),
  clinicId: z.string().uuid().optional(),
});

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
});

router.put(
  "/schedule",
  validate({ body: weeklyScheduleSchema }),
  asyncHandler(async (req, res) => {
    const updated = await service.replaceWeeklySchedule(req.user!.id, req.body.blocks);
    res.json({ success: true, data: updated });
  })
);

const exceptionSchema = z.object({
  exceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isOff: z.boolean(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

router.post(
  "/schedule/exceptions",
  validate({ body: exceptionSchema }),
  asyncHandler(async (req, res) => {
    const created = await service.addScheduleException(req.user!.id, req.body);
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
