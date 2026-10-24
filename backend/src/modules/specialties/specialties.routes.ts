import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendCatalog } from "../../lib/catalogCache";

// عدد الأطباء لكل تخصص قد يتأخر حتى 10 دقائق؛ أي تعديل على التخصصات نفسها يُبطلها فورًا.
const SPECIALTIES_TTL_MS = 10 * 60 * 1000;

const router = Router();

// GET /api/specialties — قائمة عامة، مستخدمة في البحث والفلاتر
router.get(
  "/",
  asyncHandler(async (req, res) => {
    await sendCatalog(req, res, "specialties", SPECIALTIES_TTL_MS, () => prisma.specialty.findMany({
      orderBy: { nameAr: "asc" },
      include: { _count: { select: { doctors: true } } },
    }));
  })
);

export default router;
