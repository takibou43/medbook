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
  // النظام الجديد: المريض لا يختار الوقت — إن لم يُرسل التاريخ/الوقت يعيّن النظام أول دور متاح
  // حسب مدة جلسة الطبيب وجدول عمله. تبقى اختيارية لدعم أي عميل قديم.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD")
    .optional(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "صيغة الوقت يجب أن تكون HH:mm")
    .optional(),
  // اختيار المريض الاختياري للوقت: true = احجز هذا الوقت بالضبط أو ارفض (409 «هذا الموعد لم يعد متاحًا»).
  // غيابه = السلوك السابق كما هو (الوقت المطلوب أو أقرب وقت بعده). يُتجاهَل بلا startTime.
  exactTime: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

// أيام/أوقات الطبيب المتاحة للاختيار الاختياري في واجهة الحجز. بلا date → الأيام المتاحة؛ مع date → أوقات ذلك اليوم.
export const availabilityQuerySchema = z.object({
  doctorId: z.string().uuid("طبيب غير صالح"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD")
    .optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

// معاينة أول دور متاح لدى طبيب محدد قبل تأكيد الحجز.
export const nextSlotQuerySchema = z.object({
  doctorId: z.string().uuid("طبيب غير صالح"),
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

export type NextSlotQuery = z.infer<typeof nextSlotQuerySchema>;
export type GuestSlotsQuery = z.infer<typeof guestSlotsQuerySchema>;
export type GuestBookingInput = z.infer<typeof guestBookingSchema>;
export type LookupQuery = z.infer<typeof lookupQuerySchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
