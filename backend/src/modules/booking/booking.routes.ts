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
  availabilityQuerySchema,
} from "./booking.schema";
import * as controller from "./booking.controller";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth";

const router = Router();

router.get("/slots", validate({ query: guestSlotsQuerySchema }), controller.getSlots);

// GET /api/booking/next-slot?doctorId= — أول دور متاح يعيّنه النظام (المريض لا يختار الوقت)
router.get("/next-slot", validate({ query: nextSlotQuerySchema }), controller.getNextSlot);

// GET /api/booking/availability?doctorId=[&date=YYYY-MM-DD] — اختيار اختياري: الأيام المتاحة، أو أوقات يوم
// (من قاعدة البيانات مباشرة؛ الخادم يعيد التحقق لحظة الحجز). لا يكشف أي بيانات مرضى.
router.get("/availability", validate({ query: availabilityQuerySchema }), controller.getAvailability);

// lookup/cancel لا يتطلبان حسابًا — رقم الهاتف وحده هو التحقق، لذا نقيّدهما بمعدل صارم
// (bookingLookupLimiter) يمنع تجربة أرقام هواتف عشوائية بسرعة لاكتشاف مواعيد مرضى آخرين.
router.get("/lookup", bookingLookupLimiter, validate({ query: lookupQuerySchema }), controller.lookupBookings);

// GET /api/booking/status/:id — متابعة رقم الدور لحظيًا. عامة بلا تسجيل دخول لأن الحجز
// نفسه بلا حساب؛ الحماية أن معرّف الموعد UUID غير قابل للتخمين، والرد لا يحمل أي بيانات
// عن مرضى آخرين.
router.get("/status/:id", validate({ params: bookingIdParamsSchema }), controller.getBookingStatus);

// إنشاء حجز يتطلب حساب مريض مسجّل الدخول (توكن صالح + دور PATIENT). بلا توكن أو بتوكن منتهٍ → 401،
// وبدور آخر (طبيب/مساعد/إدارة) → 403. صاحب الموعد يُحدَّد من الجلسة فقط، لا من جسم الطلب.
router.post("/", authenticate, authorize(Role.PATIENT), validate({ body: guestBookingSchema }), controller.createGuestBooking);

router.patch(
  "/:id/cancel",
  bookingLookupLimiter,
  validate({ params: bookingIdParamsSchema, body: cancelBookingSchema }),
  controller.cancelBooking
);

export default router;
