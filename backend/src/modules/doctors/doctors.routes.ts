import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./doctors.service";
import { z } from "zod";
import { validate } from "../../middleware/validate";
import { publicDiscoveryLimiter } from "../../middleware/rateLimiter";
import { doctorSearchSchema, doctorIdParams, doctorAvailabilityQuery } from "./doctorSearch.schema";

const router = Router();
router.use(publicDiscoveryLimiter);

// GET /api/doctors?specialtyId=&wilayaId=&cityId=&gender=&q=&minRating=&page=&pageSize=&lat=&lng=&maxDistanceKm=
router.get(
  "/",
  validate({ query: doctorSearchSchema }),
  asyncHandler(async (req, res) => {
    const filters = req.query as unknown as z.infer<typeof doctorSearchSchema>;
    const validGeo = filters.lat !== undefined && filters.lng !== undefined;
    const result = await service.searchDoctors({
      ...filters,
      lat: validGeo ? filters.lat : undefined,
      lng: validGeo ? filters.lng : undefined,
      maxDistanceKm: validGeo ? filters.maxDistanceKm : undefined,
    });
    res.json({ success: true, data: result });
  })
);

// GET /api/doctors/:id
router.get(
  "/:id",
  validate({ params: doctorIdParams }),
  asyncHandler(async (req, res) => {
    const doctor = await service.getDoctorById(req.params.id);
    res.json({ success: true, data: doctor });
  })
);

// GET /api/doctors/:id/availability?date=YYYY-MM-DD
router.get(
  "/:id/availability",
  validate({ params: doctorIdParams, query: doctorAvailabilityQuery }),
  asyncHandler(async (req, res) => {
    const date = req.query.date as string;
    if (!date) return res.status(400).json({ success: false, message: "معامل date مطلوب (YYYY-MM-DD)." });
    const result = await service.getDoctorAvailability(req.params.id, date);
    res.json({ success: true, data: result });
  })
);

export default router;
