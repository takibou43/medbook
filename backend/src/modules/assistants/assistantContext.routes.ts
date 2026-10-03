import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();
router.use(authenticate, authorize(Role.ASSISTANT));
router.get("/doctors", asyncHandler(async (req, res) => {
  const assistant = await prisma.assistant.findUnique({ where: { userId: req.user!.id }, include: { doctor: { select: { user: { select: { isActive: true } } } } } });
  if (!assistant?.isActive || !assistant.doctor.user.isActive) throw ApiError.forbidden();
  const doctors = await prisma.doctor.findMany({
    where: { ...(assistant.clinicId ? { clinicId: assistant.clinicId } : { id: assistant.doctorId }), user: { isActive: true } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  res.json({ success: true, data: doctors });
}));
export default router;
