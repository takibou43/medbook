import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { createAppointmentSchema, updateStatusSchema } from "./appointments.schema";
import * as controller from "./appointments.controller";

const router = Router();
router.use(authenticate);

// POST /api/appointments — المريض فقط يحجز
router.post("/", authorize(Role.PATIENT), validate({ body: createAppointmentSchema }), controller.create);

// GET /api/appointments — يرجع مواعيد المستخدم الحالي (مريض أو طبيب) حسب الدور
router.get("/", controller.listMine);

// PATCH /api/appointments/:id — تغيير الحالة (قبول/رفض/إنهاء/عدم حضور) حسب صلاحية الدور
router.patch("/:id", validate({ body: updateStatusSchema }), controller.updateStatus);

// DELETE /api/appointments/:id — إلغاء من طرف المريض
router.delete("/:id", authorize(Role.PATIENT), controller.cancel);

export default router;
