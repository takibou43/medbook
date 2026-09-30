import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as plans from "./treatment.service";
import * as followUps from "./followUpAppointment.service";
import {
  idParams,
  createPlanSchema,
  updatePlanSchema,
  listPlansQuerySchema,
  createSessionSchema,
  updateSessionSchema,
  reorderSessionsSchema,
  createFollowUpSchema,
  updateFollowUpSchema,
  followUpAppointmentSchema,
  rescheduleSchema,
  doctorSlotsQuerySchema,
  patientPlansQuerySchema,
} from "./treatment.schema";

/**
 * مسارات الطبيب الجديدة تحت /api/doctor — طبيب فقط (المساعد مرفوض 403). تُسجَّل في app.ts قبل
 * doctorSelfRoutes. المصادقة والدور لكل مسار (لا router.use) حتى تمرّ الطلبات الأخرى إلى الراوتر التالي كما هي.
 */
export const doctorTreatmentRouter = Router();
const doctorOnly = [authenticate, authorize(Role.DOCTOR)];

// ---- خطط علاج الأسنان ----
doctorTreatmentRouter.get(
  "/treatment-plans",
  ...doctorOnly,
  validate({ query: listPlansQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.listDoctorPlans(req.user!.id, req.query as any) });
  })
);

// المرضى المؤهلون لإنشاء خطة (أصحاب حسابات حجزوا عند الطبيب + أفراد عائلاتهم).
doctorTreatmentRouter.get(
  "/treatment-plans/candidates",
  ...doctorOnly,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.listPlanCandidates(req.user!.id) });
  })
);

doctorTreatmentRouter.post(
  "/treatment-plans",
  ...doctorOnly,
  validate({ body: createPlanSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await plans.createPlan(req.user!.id, req.body) });
  })
);

doctorTreatmentRouter.get(
  "/treatment-plans/:id",
  ...doctorOnly,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.getDoctorPlan(req.user!.id, req.params.id) });
  })
);

doctorTreatmentRouter.patch(
  "/treatment-plans/:id",
  ...doctorOnly,
  validate({ params: idParams, body: updatePlanSchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.updatePlan(req.user!.id, req.params.id, req.body) });
  })
);

doctorTreatmentRouter.post(
  "/treatment-plans/:id/sessions",
  ...doctorOnly,
  validate({ params: idParams, body: createSessionSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await plans.addSession(req.user!.id, req.params.id, req.body) });
  })
);

doctorTreatmentRouter.put(
  "/treatment-plans/:id/sessions/order",
  ...doctorOnly,
  validate({ params: idParams, body: reorderSessionsSchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.reorderSessions(req.user!.id, req.params.id, req.body.sessionIds) });
  })
);

doctorTreatmentRouter.patch(
  "/treatment-sessions/:id",
  ...doctorOnly,
  validate({ params: idParams, body: updateSessionSchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.updateSession(req.user!.id, req.params.id, req.body) });
  })
);

doctorTreatmentRouter.post(
  "/treatment-plans/:id/follow-ups",
  ...doctorOnly,
  validate({ params: idParams, body: createFollowUpSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await plans.addFollowUp(req.user!.id, req.params.id, req.body) });
  })
);

doctorTreatmentRouter.patch(
  "/treatment-follow-ups/:id",
  ...doctorOnly,
  validate({ params: idParams, body: updateFollowUpSchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.updateFollowUp(req.user!.id, req.params.id, req.body) });
  })
);

// ---- برمجة موعد عودة ----
doctorTreatmentRouter.get(
  "/follow-up-slots",
  ...doctorOnly,
  validate({ query: doctorSlotsQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await followUps.followUpSlotsForDate(req.user!.id, req.query.date as string) });
  })
);

doctorTreatmentRouter.post(
  "/appointments/:id/follow-up",
  ...doctorOnly,
  validate({ params: idParams, body: followUpAppointmentSchema }),
  asyncHandler(async (req, res) => {
    const { appointment, replayed } = await followUps.createFollowUpAppointment(req.user!.id, req.params.id, req.body);
    res.status(replayed ? 200 : 201).json({ success: true, data: appointment, replayed });
  })
);

doctorTreatmentRouter.post(
  "/appointments/:id/reschedule",
  ...doctorOnly,
  validate({ params: idParams, body: rescheduleSchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await followUps.rescheduleFollowUpAppointment(req.user!.id, req.params.id, req.body) });
  })
);

/** /api/patient/treatment-plans — قراءة فقط لصاحب الحساب (خططه وخطط أفراد عائلته). */
export const patientTreatmentRouter = Router();
patientTreatmentRouter.use(authenticate, authorize(Role.PATIENT));

patientTreatmentRouter.get(
  "/",
  validate({ query: patientPlansQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.listPatientPlans(req.user!.id, req.query.familyMemberId as string | undefined) });
  })
);

patientTreatmentRouter.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await plans.getPatientPlan(req.user!.id, req.params.id) });
  })
);
