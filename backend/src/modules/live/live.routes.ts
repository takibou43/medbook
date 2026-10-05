import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";
import { liveUpdates } from "../../lib/liveUpdates";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { assignedDoctors } from "../assistants/assistantBoard.service";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();
const pending = new Map<string, number>();
router.use(authenticate, authorize(Role.DOCTOR, Role.ASSISTANT));

// Long polling works with the existing Bearer header and token refresh interceptor.
// Each request rechecks account access; the signal grants no access to medical data.
router.get("/changes", asyncHandler(async (req, res) => {
  const scope = req.user!.role === Role.ASSISTANT
    ? (await assignedDoctors(req.user!.id)).map(doctor => doctor.id)
    : [await resolveActingDoctorId(req.user!.id, Role.DOCTOR)];
  const current = () => liveUpdates.current(scope);
  const revision = req.query.since;
  if (typeof revision !== "string" || revision.length > 64) {
    res.json({ success: true, data: { revision: current() } });
    return;
  }
  if (revision !== current()) {
    res.json({ success: true, data: { revision: current() } });
    return;
  }
  const userId = req.user!.id;
  const count = pending.get(userId) ?? 0;
  if (count >= 3 || pending.size >= 1000) {
    res.status(429).json({ success: false, message: "أغلق اللوحات الإضافية ثم حاول مجددًا." });
    return;
  }
  pending.set(userId, count + 1);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    unsubscribe();
    const remaining = (pending.get(userId) ?? 1) - 1;
    if (remaining) pending.set(userId, remaining);
    else pending.delete(userId);
  };
  const respond = (next: string) => {
    cleanup();
    if (!res.destroyed) res.json({ success: true, data: { revision: next } });
  };
  const unsubscribe = liveUpdates.subscribe(() => {
    if (revision !== current()) respond(current());
  });
  const timer = setTimeout(() => respond(current()), 25_000);
  res.on("close", cleanup);
}));

export default router;
