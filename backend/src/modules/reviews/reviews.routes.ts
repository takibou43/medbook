import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { Role } from "@prisma/client";
import * as service from "./reviews.service";

const router = Router();

const createSchema = z.object({
  appointmentId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

router.post(
  "/",
  authenticate,
  authorize(Role.PATIENT),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const { appointmentId, rating, comment } = req.body;
    const review = await service.createReview(req.user!.id, appointmentId, rating, comment);
    res.status(201).json({ success: true, data: review });
  })
);

router.get(
  "/doctor/:doctorId",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.listForDoctor(req.params.doctorId) });
  })
);

export default router;
