import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();

// GET /api/specialties — قائمة عامة، مستخدمة في البحث والفلاتر
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const specialties = await prisma.specialty.findMany({
      orderBy: { nameAr: "asc" },
      include: { _count: { select: { doctors: true } } },
    });
    res.json({ success: true, data: specialties });
  })
);

export default router;
