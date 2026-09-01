import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";

const router = Router();
router.use(authenticate, authorize(Role.PATIENT));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user!.id },
      include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: favorites });
  })
);

router.post(
  "/:doctorId",
  validate({ params: z.object({ doctorId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const doctor = await prisma.doctor.findUnique({ where: { id: req.params.doctorId } });
    if (!doctor) throw ApiError.notFound("الطبيب غير موجود.");
    const favorite = await prisma.favorite.upsert({
      where: { userId_doctorId: { userId: req.user!.id, doctorId: req.params.doctorId } },
      update: {},
      create: { userId: req.user!.id, doctorId: req.params.doctorId },
    });
    res.status(201).json({ success: true, data: favorite });
  })
);

router.delete(
  "/:doctorId",
  asyncHandler(async (req, res) => {
    await prisma.favorite.deleteMany({ where: { userId: req.user!.id, doctorId: req.params.doctorId } });
    res.json({ success: true, message: "تم الحذف من المفضلة." });
  })
);

export default router;
