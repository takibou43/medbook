import { Router } from "express";
import { validate } from "../../middleware/validate";
import { guestBookingSchema, guestSlotsQuerySchema } from "./booking.schema";
import * as controller from "./booking.controller";

// مسارات عامة بالكامل (بدون authenticate) — الحجز كضيف لا يتطلب تسجيل دخول أو حساب.
const router = Router();

// GET /api/booking/slots?wilayaId=&specialtyId=&date= — الأوقات المتاحة المجمّعة لكل الأطباء المطابقين
router.get("/slots", validate({ query: guestSlotsQuerySchema }), controller.getSlots);

// POST /api/booking — إنشاء حجز ضيف (اسم، لقب، ولاية، تخصص، تاريخ، وقت)
router.post("/", validate({ body: guestBookingSchema }), controller.createGuestBooking);

export default router;
