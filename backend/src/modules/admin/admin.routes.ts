import { Router } from "express";
import { z } from "zod";
import { Role, VerificationStatus } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./admin.service";
import * as blocks from "../patientBlocks/patientBlocks.service";

const router = Router();
router.use(authenticate, authorize(Role.ADMIN));

// ---- Stats ----
router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await service.getStats() });
  })
);

router.get(
  "/stats/series",
  validate({ query: z.object({ range: z.enum(["7d", "30d", "this_month", "last_month"]).default("7d") }) }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.getAppointmentsSeries((req.query as any).range) });
  })
);

router.get(
  "/appointments",
  validate({
    query: z.object({
      filter: z.enum(["all", "today", "completed", "cancelled"]).default("all"),
      q: z.string().max(100).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.listAppointmentsAdmin(req.query as any) });
  })
);

router.get("/activity", asyncHandler(async (_req, res) => res.json({ success: true, data: await service.getRecentActivity() })));
router.get("/system-status", asyncHandler(async (_req, res) => res.json({ success: true, data: await service.getSystemStatus() })));
router.get(
  "/search",
  validate({ query: z.object({ q: z.string().max(100) }) }),
  asyncHandler(async (req, res) => res.json({ success: true, data: await service.globalSearch((req.query as any).q) }))
);

// ---- Maintenance ----
// حذف البيانات التجريبية فقط (حسابات seed) — لا تمسّ المستخدمين الحقيقيين ولا البيانات المرجعية.
router.post(
  "/maintenance/purge-demo-data",
  asyncHandler(async (req, res) => {
    const result = await service.purgeDemoData();
    await service.logAction(req.user!.id, "PURGE_DEMO_DATA", "System", "-", result);
    res.json({ success: true, message: "تم حذف البيانات التجريبية.", data: result });
  })
);

// ---- Users ----
router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const { role, q, page, pageSize } = req.query;
    res.json({
      success: true,
      data: await service.listUsers({
        role: role as Role,
        q: q as string,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    });
  })
);

router.post(
  "/users",
  validate({ body: z.object({ email: z.string().email(), password: z.string().min(8), phone: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { email, password, phone } = req.body;
    const user = await service.createAdminUser(email, password, phone);
    await service.logAction(req.user!.id, "CREATE_ADMIN_USER", "User", user.id);
    res.status(201).json({ success: true, data: user });
  })
);

router.patch(
  "/users/:id/activate",
  asyncHandler(async (req, res) => {
    const user = await service.setUserActive(req.params.id, true);
    await service.logAction(req.user!.id, "ACTIVATE_USER", "User", req.params.id);
    res.json({ success: true, data: user });
  })
);

router.patch(
  "/users/:id/deactivate",
  asyncHandler(async (req, res) => {
    const user = await service.setUserActive(req.params.id, false);
    await service.logAction(req.user!.id, "DEACTIVATE_USER", "User", req.params.id);
    res.json({ success: true, data: user });
  })
);

router.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    await service.deleteUser(req.params.id, req.user!.id);
    await service.logAction(req.user!.id, "DELETE_USER", "User", req.params.id);
    res.json({ success: true, message: "تم حذف المستخدم." });
  })
);

// ---- Patient blocks (حظر المرضى من إنشاء حجوزات جديدة) — للإدارة فقط (router.use أعلاه) ----
router.get(
  "/patient-blocks",
  validate({
    query: z.object({
      status: z.enum(["active", "all"]).default("active"),
      q: z.string().max(100).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await blocks.listPatientBlocks(req.query as any) });
  })
);

router.post(
  "/patients/:patientId/block",
  validate({ params: z.object({ patientId: z.string().uuid() }), body: z.object({ reason: z.string().trim().max(500).optional() }) }),
  asyncHandler(async (req, res) => {
    const block = await blocks.blockPatient(req.params.patientId, req.user!.id, req.body.reason);
    await service.logAction(req.user!.id, "BLOCK_PATIENT", "Patient", req.params.patientId, { reason: block.reason, blockId: block.id });
    res.status(201).json({ success: true, message: "تم حظر المريض. لن يستطيع إنشاء حجوزات جديدة.", data: block });
  })
);

router.post(
  "/patients/:patientId/unblock",
  validate({ params: z.object({ patientId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const block = await blocks.unblockPatient(req.params.patientId, req.user!.id);
    await service.logAction(req.user!.id, "UNBLOCK_PATIENT", "Patient", req.params.patientId, { blockId: block?.id, blockType: block?.blockType });
    res.json({ success: true, message: "تم رفع الحظر عن المريض.", data: block });
  })
);

// ---- Doctors ----
router.get(
  "/doctors",
  asyncHandler(async (req, res) => {
    const { verificationStatus, q, page, pageSize } = req.query;
    res.json({
      success: true,
      data: await service.listDoctorsAdmin({
        verificationStatus: verificationStatus as VerificationStatus,
        q: q as string,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    });
  })
);

router.patch(
  "/doctors/:id/verify",
  validate({ body: z.object({ status: z.enum(["PENDING", "VERIFIED", "REJECTED"]) }) }),
  asyncHandler(async (req, res) => {
    const doctor = await service.setDoctorVerification(req.params.id, req.body.status);
    await service.logAction(req.user!.id, "SET_DOCTOR_VERIFICATION", "Doctor", req.params.id, { status: req.body.status });
    res.json({ success: true, data: doctor });
  })
);

router.patch(
  "/doctors/:id",
  asyncHandler(async (req, res) => {
    const doctor = await service.updateDoctorAdmin(req.params.id, req.body);
    await service.logAction(req.user!.id, "UPDATE_DOCTOR", "Doctor", req.params.id);
    res.json({ success: true, data: doctor });
  })
);

// ---- Specialties CRUD ----
router.get(
  "/specialties",
  asyncHandler(async (_req, res) => res.json({ success: true, data: await service.specialtiesAdmin.list() }))
);
router.post(
  "/specialties",
  validate({ body: z.object({ nameAr: z.string().min(2), nameFr: z.string().optional(), icon: z.string().optional(), description: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const created = await service.specialtiesAdmin.create(req.body);
    res.status(201).json({ success: true, data: created });
  })
);
router.patch(
  "/specialties/:id",
  asyncHandler(async (req, res) => res.json({ success: true, data: await service.specialtiesAdmin.update(req.params.id, req.body) }))
);
router.delete(
  "/specialties/:id",
  asyncHandler(async (req, res) => {
    await service.specialtiesAdmin.remove(req.params.id);
    res.json({ success: true, message: "تم الحذف." });
  })
);

// ---- Wilayas / Cities CRUD ----
router.get(
  "/wilayas",
  asyncHandler(async (_req, res) => res.json({ success: true, data: await service.wilayasAdmin.list() }))
);
router.post(
  "/wilayas",
  validate({ body: z.object({ code: z.string(), nameAr: z.string(), nameFr: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const created = await service.wilayasAdmin.create(req.body);
    res.status(201).json({ success: true, data: created });
  })
);
router.patch(
  "/wilayas/:id",
  asyncHandler(async (req, res) => res.json({ success: true, data: await service.wilayasAdmin.update(req.params.id, req.body) }))
);
router.delete(
  "/wilayas/:id",
  asyncHandler(async (req, res) => {
    await service.wilayasAdmin.remove(req.params.id);
    res.json({ success: true, message: "تم الحذف." });
  })
);
router.post(
  "/wilayas/:id/cities",
  validate({ body: z.object({ nameAr: z.string().min(2) }) }),
  asyncHandler(async (req, res) => {
    const created = await service.wilayasAdmin.addCity(req.params.id, req.body.nameAr);
    res.status(201).json({ success: true, data: created });
  })
);
// إضافة دفعة بلديات لولاية واحدة — تُستخدم لتعبئة البيانات المرجعية (بلديات الجزائر) دفعة واحدة.
router.post(
  "/wilayas/:id/cities/bulk",
  validate({ body: z.object({ names: z.array(z.string().min(2)).min(1).max(200) }) }),
  asyncHandler(async (req, res) => {
    const result = await service.wilayasAdmin.addCitiesBulk(req.params.id, req.body.names);
    res.status(201).json({ success: true, data: result });
  })
);
router.delete(
  "/cities/:id",
  asyncHandler(async (req, res) => {
    await service.wilayasAdmin.removeCity(req.params.id);
    res.json({ success: true, message: "تم الحذف." });
  })
);

// ---- Reviews moderation ----
router.get(
  "/reviews",
  asyncHandler(async (_req, res) => res.json({ success: true, data: await service.listAllReviews() }))
);
router.delete(
  "/reviews/:id",
  asyncHandler(async (req, res) => {
    await service.deleteReview(req.params.id);
    res.json({ success: true, message: "تم حذف التقييم." });
  })
);

export default router;
