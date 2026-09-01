import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./doctors.service";

const router = Router();

// GET /api/doctors?specialtyId=&wilayaId=&cityId=&gender=&q=&minRating=&page=&pageSize=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { specialtyId, wilayaId, cityId, gender, q, minRating, page, pageSize } = req.query;
    const result = await service.searchDoctors({
      specialtyId: specialtyId as string,
      wilayaId: wilayaId as string,
      cityId: cityId as string,
      gender: gender as "MALE" | "FEMALE",
      q: q as string,
      minRating: minRating ? Number(minRating) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json({ success: true, data: result });
  })
);

// GET /api/doctors/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const doctor = await service.getDoctorById(req.params.id);
    res.json({ success: true, data: doctor });
  })
);

// GET /api/doctors/:id/availability?date=YYYY-MM-DD
router.get(
  "/:id/availability",
  asyncHandler(async (req, res) => {
    const date = req.query.date as string;
    if (!date) return res.status(400).json({ success: false, message: "معامل date مطلوب (YYYY-MM-DD)." });
    const result = await service.getDoctorAvailability(req.params.id, date);
    res.json({ success: true, data: result });
  })
);

export default router;
