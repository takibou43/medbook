import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();

// GET /api/wilayas — مع البلديات (Cities) لكل ولاية
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const wilayas = await prisma.wilaya.findMany({
      orderBy: { nameAr: "asc" },
      include: { cities: { orderBy: { nameAr: "asc" } } },
    });
    res.json({ success: true, data: wilayas });
  })
);

// GET /api/wilayas/:id/cities
router.get(
  "/:id/cities",
  asyncHandler(async (req, res) => {
    const cities = await prisma.city.findMany({ where: { wilayaId: req.params.id }, orderBy: { nameAr: "asc" } });
    res.json({ success: true, data: cities });
  })
);

export default router;
