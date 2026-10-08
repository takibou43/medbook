import { Router } from "express";
import { z } from "zod";
import { Role, SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { authLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./clinics.service";
import { assistantScopeSchema, managerPermissionsSchema } from "../../lib/clinicPermissions";
import { clinicProfileSchema, clinicIdParams, clinicSearchSchema, emailInviteSchema, tokenSchema, clinicInviteSchema, financeRangeSchema } from "./clinics.schema";
const router = Router();
const owner = [authenticate, authorize(Role.CLINIC_OWNER, Role.DOCTOR)];
const send = (res: import("express").Response, data: unknown) => res.json({ success: true, data });
router.get("/", validate({ query: clinicSearchSchema }), asyncHandler(async (req, res) => send(res, await service.searchClinics(req.query as unknown as z.infer<typeof clinicSearchSchema>))));
router.get("/invites/:token", authLimiter, validate({ params: tokenSchema }), asyncHandler(async (req, res) => send(res, await service.previewInvite(req.params.token))));
router.post("/invites/accept", authenticate, authorize(Role.DOCTOR), validate({ body: tokenSchema }), asyncHandler(async (req, res) => send(res, await service.acceptExistingDoctor(req.user!.id, req.body.token))));
router.get("/mine", ...owner, asyncHandler(async (req, res) => send(res, await service.getOwnClinic(req.user!.id))));
router.post("/mine/assistants", ...owner, validate({ body: z.object({ email: emailInviteSchema.shape.email, ...assistantScopeSchema.shape }).strict() }), asyncHandler(async (req, res) => send(res, await service.inviteOwnClinicAssistant(req.user!.id, req.body.email, req.body))));
router.patch("/mine/assistants/:id/scope", ...owner, validate({ params: clinicIdParams, body: assistantScopeSchema }), asyncHandler(async (req, res) => send(res, await service.setOwnClinicAssistantScope(req.user!.id, req.params.id, req.body))));
router.patch("/mine/doctors/:id/manager", ...owner, validate({ params: clinicIdParams, body: managerPermissionsSchema }), asyncHandler(async (req, res) => send(res, await service.setClinicManager(req.user!.id, req.params.id, req.body))));
router.get("/transfers/mine", authenticate, authorize(Role.DOCTOR), asyncHandler(async (req, res) => send(res, await service.listOwnTransfers(req.user!.id))));
router.post("/transfers", authenticate, authorize(Role.DOCTOR), validate({ body: z.object({ clinicId: z.string().uuid() }).strict() }), asyncHandler(async (req, res) => { res.status(201); send(res, await service.requestClinicTransfer(req.user!.id, req.body.clinicId)); }));
router.get("/admin/transfers", authenticate, authorize(Role.ADMIN), asyncHandler(async (_req, res) => send(res, await service.adminListTransfers())));
router.patch("/admin/transfers/:id", authenticate, authorize(Role.ADMIN), validate({ params: clinicIdParams, body: z.object({ approve: z.boolean() }).strict() }), asyncHandler(async (req, res) => send(res, await service.reviewTransfer(req.user!.id, req.params.id, req.body.approve))));
router.post("/mine", ...owner, validate({ body: clinicProfileSchema }), asyncHandler(async (req, res) => { res.status(201); send(res, await service.createOwnClinic(req.user!.id, req.body)); }));
router.patch("/mine", ...owner, validate({ body: clinicProfileSchema }), asyncHandler(async (req, res) => send(res, await service.updateOwnClinic(req.user!.id, req.body))));
router.post("/mine/invites", ...owner, validate({ body: clinicInviteSchema }), asyncHandler(async (req, res) => { res.status(201); send(res, await service.inviteDoctor(req.user!.id, req.body.email, { appointmentPriceDzd: req.body.appointmentPriceDzd, doctorSharePercent: req.body.doctorSharePercent })); }));
// سعر الموعد ونسبة الطبيب لطبيب تابع للعيادة: مدير العيادة وحده (ownedClinic يفرض الملكية). التحقق من القيم داخل setDoctorTerms.
router.patch("/mine/doctors/:id/terms", ...owner, validate({ params: clinicIdParams }), asyncHandler(async (req, res) => send(res, await service.setDoctorTerms(req.user!.id, req.params.id, req.body))));
router.get("/mine/finance", ...owner, validate({ query: financeRangeSchema }), asyncHandler(async (req, res) => send(res, await service.clinicFinanceReport(req.user!.id, req.query as { from?: string; to?: string }))));
router.delete("/mine/invites/:id", ...owner, validate({ params: clinicIdParams }), asyncHandler(async (req, res) => { await service.revokeDoctorInvite(req.user!.id, req.params.id); send(res, null); }));
router.get("/mine/doctors/:id/assistants", ...owner, validate({ params: clinicIdParams }), asyncHandler(async (req, res) => {
  await service.ownedClinic(req.user!.id, undefined, "OWNER");
  await service.clinicDoctor(req.user!.id, req.params.id);
  const clinic = await service.getOwnClinic(req.user!.id);
  send(res, { assistants: clinic.doctors.find(d => d.id === req.params.id)?.assistants ?? [], invites: [] });
}));
router.post("/mine/doctors/:id/assistants", ...owner, validate({ params: clinicIdParams, body: emailInviteSchema }), asyncHandler(async (req, res) => {
  await service.ownedClinic(req.user!.id, undefined, "OWNER");
  await service.clinicDoctor(req.user!.id, req.params.id);
  send(res, await service.inviteOwnClinicAssistant(req.user!.id, req.body.email));
}));
router.patch("/mine/doctors/:id/assistants/:assistantId", ...owner, validate({
  params: z.object({ id: z.string().uuid(), assistantId: z.string().uuid() }).strict(),
  body: z.object({ isActive: z.boolean() }).strict(),
}), asyncHandler(async (req, res) => {
  send(res, await service.setOwnClinicAssistantActive(req.user!.id, req.params.id, req.params.assistantId, req.body.isActive));
}));
router.get("/admin/list", authenticate, authorize(Role.ADMIN), validate({query:z.object({page:z.coerce.number().int().min(1).max(1000).optional(),q:z.string().trim().max(100).optional(),id:z.string().uuid().optional(),verificationStatus:z.nativeEnum(VerificationStatus).optional(),subscriptionStatus:z.nativeEnum(SubscriptionStatus).optional()}).strict()}), asyncHandler(async (req, res) => send(res, await service.adminListClinics(req.query as any))));
router.patch("/admin/:id", authenticate, authorize(Role.ADMIN), validate({ params: clinicIdParams, body: z.object({
  verificationStatus: z.nativeEnum(VerificationStatus).optional(), subscriptionStatus: z.nativeEnum(SubscriptionStatus).optional(),
  expectedSnapshot:z.string().max(1000).optional(), subscriptionExpiresAt: z.coerce.date().nullable().optional(), paidDoctorCount: z.number().int().min(0).max(1000).optional(),
}).strict() }), asyncHandler(async (req, res) => send(res, await service.adminUpdateClinic(req.params.id, req.body))));
router.get("/:id", validate({ params: clinicIdParams }), asyncHandler(async (req, res) => send(res, await service.publicClinic(req.params.id))));
export default router;
