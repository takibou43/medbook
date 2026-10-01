import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createFamilyMemberSchema,
  updateFamilyMemberSchema,
  familyMemberParamsSchema,
  listFamilyQuerySchema,
} from "./family.schema";
import * as service from "./family.service";

/**
 * /api/patient/family-members — مريض مسجّل الدخول فقط. صاحب الحساب من الجلسة وحدها.
 * يُسجَّل في app.ts قبل "/api/patient" العام.
 */
const router = Router();
router.use(authenticate, authorize(Role.PATIENT));

router.get(
  "/",
  validate({ query: listFamilyQuerySchema }),
  asyncHandler(async (req, res) => {
    const data = await service.listFamilyMembers(req.user!.id, req.query.includeArchived === "true");
    res.json({ success: true, data });
  })
);

router.post(
  "/",
  validate({ body: createFamilyMemberSchema }),
  asyncHandler(async (req, res) => {
    const data = await service.createFamilyMember(req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  })
);

router.patch(
  "/:id",
  validate({ params: familyMemberParamsSchema, body: updateFamilyMemberSchema }),
  asyncHandler(async (req, res) => {
    const data = await service.updateFamilyMember(req.user!.id, req.params.id, req.body);
    res.json({ success: true, data });
  })
);

// DELETE = أرشفة (archivedAt)، لا حذف فعلي — المواعيد وخطط العلاج تبقى.
router.delete(
  "/:id",
  validate({ params: familyMemberParamsSchema }),
  asyncHandler(async (req, res) => {
    const data = await service.archiveFamilyMember(req.user!.id, req.params.id);
    res.json({ success: true, data, message: "تمت أرشفة فرد العائلة. تبقى مواعيده السابقة محفوظة." });
  })
);

export default router;
