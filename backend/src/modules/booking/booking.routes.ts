import { Router } from "express";
import { validate } from "../../middleware/validate";
import {
  guestBookingSchema,
  guestSlotsQuerySchema,
  lookupQuerySchema,
  cancelBookingSchema,
  bookingIdParamsSchema,
} from "./booking.schema";
import * as controller from "./booking.controller";

const router = Router();

router.get("/slots", validate({ query: guestSlotsQuerySchema }), controller.getSlots);

router.get("/lookup", validate({ query: lookupQuerySchema }), controller.lookupBookings);

router.post("/", validate({ body: guestBookingSchema }), controller.createGuestBooking);

router.patch(
  "/:id/cancel",
  validate({ params: bookingIdParamsSchema, body: cancelBookingSchema }),
  controller.cancelBooking
);

export default router;
