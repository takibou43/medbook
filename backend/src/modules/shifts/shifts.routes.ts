import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { setShift, shiftState } from "./shifts.service";
const router = Router();
router.use(authenticate, authorize(Role.DOCTOR, Role.ASSISTANT));
router.get("/", asyncHandler(async (req, res) => {
  res.json({ success: true, data: await shiftState(req.user!.id, req.user!.role) });
}));
router.post("/", asyncHandler(async (req, res) => {
  if (req.body.endTime !== null && typeof req.body.endTime !== "string") throw ApiError.badRequest("حدد وقت النهاية.");
  res.json({ success: true, data: await setShift(req.user!.id, req.user!.role, req.body.endTime) });
}));
export default router;
