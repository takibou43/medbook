import { Router } from "express";
import { z } from "zod";
import { Role, SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { authLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./clinics.service";
import * as assistants from "../assistants/assistants.service";
import { clinicProfileSchema, clinicIdParams, clinicSearchSchema, emailInviteSchema, tokenSchema } from "./clinics.schema";
const router = Router();
const owner = [authenticate, authorize(Role.CLINIC_OWNER, Role.DOCTOR)];
const send = (res: import("express").Response, data: unknown) => res.json({ success: true, data });
router.get("/", validate({ query: clinicSearchSchema }), asyncHandler(async (req, res) => send(res, await service.searchClinics(req.query as unknown as z.infer<typeof clinicSearchSchema>))));
router.get("/invites/:token", authLimiter, validate({ params: tokenSchema }), asyncHandler(async (req, res) => send(res, await service.previewInvite(req.params.token))));
router.post("/invites/accept", authenticate, authorize(Role.DOCTOR), validate({ body: tokenSchema }), asyncHandler(async (req, res) => send(res, await service.acceptExistingDoctor(req.user!.id, req.body.token))));
router.get("/mine", ...owner, asyncHandler(async (req, res) => send(res, await service.getOwnClinic(req.user!.id))));
router.post("/mine", ...owner, validate({ body: clinicProfileSchema }), asyncHandler(async (req, res) => { res.status(201); send(res, await service.createOwnClinic(req.user!.id, req.body)); }));
router.patch("/mine", ...owner, validate({ body: clinicProfileSchema }), asyncHandler(async (req, res) => send(res, await service.updateOwnClinic(req.user!.id, req.body))));
router.post("/mine/invites", ...owner, validate({ body: emailInviteSchema }), asyncHandler(async (req, res) => { res.status(201); send(res, await service.inviteDoctor(req.user!.id, req.body.email)); }));
router.delete("/mine/invites/:id", ...owner, validate({ params: clinicIdParams }), asyncHandler(async (req, res) => { await service.revokeDoctorInvite(req.user!.id, req.params.id); send(res, null); }));
router.get("/mine/doctors/:id/assistants", ...owner, validate({ params: clinicIdParams }), asyncHandler(async (req, res) => {
  const doctor = await service.clinicDoctor(req.user!.id, req.params.id);
  const result = await assistants.listAssistants(doctor.userId);
  send(res, { ...result, invites: result.invites.map(({ tokenHash: _hash, ...invite }) => invite) });
}));
router.post("/mine/doctors/:id/assistants", ...owner, validate({ params: clinicIdParams, body: emailInviteSchema }), asyncHandler(async (req, res) => {
  const doctor = await service.clinicDoctor(req.user!.id, req.params.id);
  const result = await assistants.createInvite(doctor.userId, req.body.email);
  const { tokenHash: _hash, ...invite } = result.invite;
  send(res, { invite, rawToken: result.rawToken });
}));
router.patch("/mine/doctors/:id/assistants/:assistantId", ...owner, validate({
  params: z.object({ id: z.string().uuid(), assistantId: z.string().uuid() }).strict(),
  body: z.object({ isActive: z.boolean() }).strict(),
}), asyncHandler(async (req, res) => {
  const doctor = await service.clinicDoctor(req.user!.id, req.params.id);
  send(res, await assistants.setAssistantActive(doctor.userId, req.params.assistantId, req.body.isActive));
}));
router.get("/admin/list", authenticate, authorize(Role.ADMIN), asyncHandler(async (_req, res) => send(res, await service.adminListClinics())));
router.patch("/admin/:id", authenticate, authorize(Role.ADMIN), validate({ params: clinicIdParams, body: z.object({
  verificationStatus: z.nativeEnum(VerificationStatus).optional(), subscriptionStatus: z.nativeEnum(SubscriptionStatus).optional(),
  subscriptionExpiresAt: z.coerce.date().nullable().optional(), paidDoctorCount: z.number().int().min(0).max(1000).optional(),
}).strict() }), asyncHandler(async (req, res) => send(res, await service.adminUpdateClinic(req.params.id, req.body))));
router.get("/:id", validate({ params: clinicIdParams }), asyncHandler(async (req, res) => send(res, await service.publicClinic(req.params.id))));
export default router;
