import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requestUrgency, decideUrgency } from "./urgency.service";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { createAppointmentSchema, updateStatusSchema, walkInSchema } from "./appointments.schema";
import * as controller from "./appointments.controller";

const router = Router();
router.use(authenticate);

// POST /api/appointments — المريض فقط يحجز
router.post("/", authorize(Role.PATIENT), validate({ body: createAppointmentSchema }), controller.create);

// POST /api/appointments/walk-in — مريض حضر بدون موعد: المساعد وحده يسجّله من الاستقبال (ضيف بالاسم والهاتف،
// اليوم، أول وقت شاغر، وصل الآن، بلا إشعارات). الطبيب يجدول مرضاه عبر «موعد العودة» لا من هنا.
router.post("/walk-in", authorize(Role.ASSISTANT), validate({ body: walkInSchema }), controller.walkIn);

// GET /api/appointments — يرجع مواعيد المستخدم الحالي (مريض أو طبيب) حسب الدور
router.get("/", controller.listMine);

// ---- طابور العيادة اليومي — للطبيب وحده ----
// يجب تعريفها قبل مسار '/:id' حتى لا تُفهم كلمة queue على أنها معرّف موعد.

// طابور اليوم متاح للطبيب وللمساعد معًا (صلاحية كاملة للمساعد على عمليات الطابور —
// نداء/تأجيل/إنهاء — حسب ما اتُّفق عليه؛ الملكية تُتحقق داخل الخدمة عبر resolveActingDoctorId).

// GET /api/appointments/queue — حالة طابور اليوم: المريض الحالي والمنتظرون والمتأخرون
router.get("/queue", authorize(Role.DOCTOR, Role.ASSISTANT), controller.queue);

// POST /api/appointments/queue/next — مناداة المريض التالي
router.post("/queue/next", authorize(Role.DOCTOR, Role.ASSISTANT), controller.callNext);

// POST /api/appointments/:id/late — لم يستجب للنداء: يُنقل إلى قائمة المتأخرين بدل شطبه
router.post("/:id/late", authorize(Role.DOCTOR, Role.ASSISTANT), controller.markLate);

// POST /api/appointments/:id/call — مناداة مريض بعينه فورًا (متأخر عاد قبل انتهاء دوره)
router.post("/:id/call", authorize(Role.DOCTOR, Role.ASSISTANT), controller.callPatient);

// POST /api/appointments/:id/arrived — تسجيل وصول المريض فعليًا إلى العيادة (اختياري)
router.post("/:id/arrived", authorize(Role.DOCTOR, Role.ASSISTANT), controller.markArrived);

router.post("/:id/urgency", authorize(Role.DOCTOR, Role.ASSISTANT), validate({ body: z.object({ reason: z.string().trim().min(1).max(500) }) }), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await requestUrgency(req.user!.id, req.user!.role, req.params.id, req.body.reason) });
}));
router.post("/:id/urgency/decision", authorize(Role.DOCTOR), validate({ body: z.object({ approve: z.boolean() }) }), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await decideUrgency(req.user!.id, req.user!.role, req.params.id, req.body.approve) });
}));

// PATCH /api/appointments/:id — تغيير الحالة (قبول/رفض/إنهاء/عدم حضور) حسب صلاحية الدور
router.patch("/:id", validate({ body: updateStatusSchema }), controller.updateStatus);

// DELETE /api/appointments/:id — إلغاء من طرف المريض
router.delete("/:id", authorize(Role.PATIENT), controller.cancel);

export default router;
