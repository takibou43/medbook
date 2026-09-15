import { Router } from "express";
import { validate } from "../../middleware/validate";
import { bookingLookupLimiter } from "../../middleware/rateLimiter";
import {
  guestBookingSchema,
  guestSlotsQuerySchema,
  lookupQuerySchema,
  cancelBookingSchema,
  bookingIdParamsSchema,
  nextSlotQuerySchema,
} from "./booking.schema";
import * as controller from "./booking.controller";

const router = Router();

router.get("/slots", validate({ query: guestSlotsQuerySchema }), controller.getSlots);

// GET /api/booking/next-slot?doctorId= — أول دور متاح يعيّنه النظام (المريض لا يختار الوقت)
router.get("/next-slot", validate({ query: nextSlotQuerySchema }), controller.getNextSlot);

// lookup/cancel لا يتطلبان حسابًا — رقم الهاتف وحده هو التحقق، لذا نقيّدهما بمعدل صارم
// (bookingLookupLimiter) يمنع تجربة أرقام هواتف عشوائية بسرعة لاكتشاف مواعيد مرضى آخرين.
router.get("/lookup", bookingLookupLimiter, validate({ query: lookupQuerySchema }), controller.lookupBookings);

// GET /api/booking/status/:id — متابعة رقم الدور لحظيًا. عامة بلا تسجيل دخول لأن الحجز
// نفسه بلا حساب؛ الحماية أن معرّف الموعد UUID غير قابل للتخمين، والرد لا يحمل أي بيانات
// عن مرضى آخرين.
router.get("/status/:id", validate({ params: bookingIdParamsSchema }), controller.getBookingStatus);

router.post("/", validate({ body: guestBookingSchema }), controller.createGuestBooking);

router.patch(
  "/:id/cancel",
  bookingLookupLimiter,
  validate({ params: bookingIdParamsSchema, body: cancelBookingSchema }),
  controller.cancelBooking
);

export default router;
