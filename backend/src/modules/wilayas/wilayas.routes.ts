import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendCatalog } from "../../lib/catalogCache";

// تُبطَل فورًا عند أي تعديل من الإدارة؛ المدة حدّ أمان فقط.
const CATALOG_TTL_MS = 60 * 60 * 1000;

const router = Router();

// GET /api/wilayas — مع البلديات (Cities) لكل ولاية
router.get(
  "/",
  asyncHandler(async (req, res) => {
    await sendCatalog(req, res, "wilayas", CATALOG_TTL_MS, () => prisma.wilaya.findMany({
      orderBy: { nameAr: "asc" },
      include: { cities: { orderBy: { nameAr: "asc" } } },
    }));
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
