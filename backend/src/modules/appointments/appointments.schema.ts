import { z } from "zod";

export const createAppointmentSchema = z.object({
  doctorId: z.string().uuid("طبيب غير صالح"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "صيغة الوقت يجب أن تكون HH:mm"),
  type: z.enum(["IN_PERSON", "FOLLOW_UP", "ONLINE"]).default("IN_PERSON"),
  notes: z.string().max(1000).optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
  // الحساب العائلي: المستفيد من الموعد (يُتحقق من ملكيته في الخادم). غيابه = الموعد لصاحب الحساب.
  familyMemberId: z.string().uuid("فرد عائلة غير صالح").optional(),
});

// IN_PROGRESS مطلوبة هنا لحالة "حضر متأخرًا": المريض الذي سُجّل غيابه ثم وصل بعد
// دقائق يُعاد إلى IN_PROGRESS عبر هذا المسار. من يملك حق أي انتقال يبقى محكومًا
// بـ ALLOWED_TRANSITIONS وليس بهذا المُحقِّق.
export const updateStatusSchema = z.object({
  // RESCHEDULE_REQUIRED يضبطها الخادم وحده عند تعارض الدوام؛ لا يقبلها هذا المسار من العميل.
  status: z.enum(["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * «مريض حضر بدون موعد» — المساعد يسجّله من الاستقبال (POST /api/appointments/walk-in).
 * ضيف بالاسم والهاتف فقط: لا patientId ولا familyMemberId يُقبلان من العميل (strict)، ولا ربط بأي حساب
 * اعتمادًا على الاسم أو الهاتف. idempotencyKey يمنع إنشاء موعدين عند النقر المزدوج أو إعادة الإرسال.
 */
export const walkInSchema = z
  .object({
    firstName: z.string().trim().min(2, "الاسم قصير جدًا").max(60, "الاسم طويل جدًا"),
    lastName: z.string().trim().min(2, "اللقب قصير جدًا").max(60, "اللقب طويل جدًا"),
    // نقبل المسافات والشرطات أثناء الكتابة ونحفظ الرقم بلا فواصل (نفس صيغة حجز الضيف: 0551234567).
    phone: z
      .string()
      .transform((s) => s.replace(/[\s-]/g, ""))
      .pipe(z.string().regex(/^0[5-7][0-9]{8}$/, "رقم هاتف جزائري غير صالح (مثال: 0551234567)")),
    notes: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().uuid("مفتاح الطلب غير صالح"),
  })
  .strict();

export type WalkInInput = z.infer<typeof walkInSchema>;
