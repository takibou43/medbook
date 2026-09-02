import { z } from "zod";

export const guestSlotsQuerySchema = z.object({
  wilayaId: z.string().uuid("ولاية غير صالحة"),
  specialtyId: z.string().uuid("تخصص غير صالح"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD"),
});

export const guestBookingSchema = z.object({
  firstName: z.string().trim().min(2, "الاسم قصير جدًا").max(60),
  lastName: z.string().trim().min(2, "اللقب قصير جدًا").max(60),
  phone: z
    .string()
    .trim()
    .regex(/^0[5-7][0-9]{8}$/, "رقم هاتف جزائري غير صالح (مثال: 0551234567)")
    .optional()
    .or(z.literal("")),
  wilayaId: z.string().uuid("ولاية غير صالحة"),
  specialtyId: z.string().uuid("تخصص غير صالح"),
  doctorId: z.string().uuid("طبيب غير صالح").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "صيغة الوقت يجب أن تكون HH:mm"),
  notes: z.string().max(1000).optional(),
});

export const lookupQuerySchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^0[5-7][0-9]{8}$/, "رقم هاتف جزائري غير صالح (مثال: 0551234567)"),
});

export const cancelBookingSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^0[5-7][0-9]{8}$/, "رقم هاتف جزائري غير صالح (مثال: 0551234567)"),
});

export const bookingIdParamsSchema = z.object({
  id: z.string().uuid("معرّف حجز غير صالح"),
});

export type GuestSlotsQuery = z.infer<typeof guestSlotsQuerySchema>;
export type GuestBookingInput = z.infer<typeof guestBookingSchema>;
export type LookupQuery = z.infer<typeof lookupQuerySchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
