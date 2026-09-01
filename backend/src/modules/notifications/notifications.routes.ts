import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./notifications.service";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const onlyUnread = req.query.unread === "true";
    res.json({ success: true, data: await service.listForUser(req.user!.id, onlyUnread) });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    await service.markAsRead(req.user!.id, req.params.id);
    res.json({ success: true });
  })
);

router.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    await service.markAllAsRead(req.user!.id);
    res.json({ success: true });
  })
);

export default router;
