import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { assistantDoctorWhere } from "../../lib/assistantScope";
import { assistantQueues, assistantAppointments } from "./assistantBoard.service";
import { algeriaTodayUTCMidnight } from "../../lib/slots";

const router = Router();
router.use(authenticate, authorize(Role.ASSISTANT));
router.get("/queues", asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assistantQueues(req.user!.id) });
}));
router.get("/appointments", asyncHandler(async (req, res) => {
  const date = req.query.date ?? algeriaTodayUTCMidnight().toISOString().slice(0, 10);
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw ApiError.badRequest("اختر تاريخًا صحيحًا.");
  res.json({ success: true, data: await assistantAppointments(req.user!.id, date) });
}));
router.get("/doctors", asyncHandler(async (req, res) => {
  const assistant = await prisma.assistant.findUnique({ where: { userId: req.user!.id }, include: { doctor: { select: { user: { select: { isActive: true } } } } } });
  if (!assistant?.isActive || (!assistant.clinicId && !assistant.doctor.user.isActive)) throw ApiError.forbidden();
  const doctors = await prisma.doctor.findMany({
    where: assistantDoctorWhere(assistant),
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  res.json({ success: true, data: doctors });
}));
export default router;
