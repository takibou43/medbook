import { z } from "zod";
import { cleanString, cleanOptionalMultiline } from "../../lib/textClean";

const dateOnly = (msg = "صيغة التاريخ يجب أن تكون YYYY-MM-DD") =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, msg)
    .transform((s, ctx) => {
      const d = new Date(s + "T00:00:00Z");
      if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "تاريخ غير صالح" });
        return z.NEVER;
      }
      return d;
    });

export const idParams = z.object({ id: z.string().uuid("معرّف غير صالح") });

// ---------- خطط العلاج (طبيب) ----------

// doctorId غير موجود في أي مخطط: يُشتق من الجلسة فقط. .strict() يرفض أي حقل إضافي.
export const createPlanSchema = z
  .object({
    patientId: z.string().uuid("مريض غير صالح"),
    familyMemberId: z.string().uuid("فرد عائلة غير صالح").nullable().optional(),
    title: cleanString(2, 120, "عنوان الخطة قصير جدًا", "عنوان الخطة طويل جدًا"),
    description: cleanOptionalMultiline(2000, "الوصف طويل جدًا"),
    estimatedSessions: z.coerce.number().int().min(1).max(100).nullable().optional(),
    estimatedTotalCost: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const updatePlanSchema = z
  .object({
    title: cleanString(2, 120, "عنوان الخطة قصير جدًا", "عنوان الخطة طويل جدًا").optional(),
    description: cleanOptionalMultiline(2000, "الوصف طويل جدًا"),
    estimatedSessions: z.coerce.number().int().min(1).max(100).nullable().optional(),
    estimatedTotalCost: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
    // الانتقالات المسموحة: ACTIVE → COMPLETED | CANCELLED فقط (تُفحص في الخدمة).
    status: z.enum(["COMPLETED", "CANCELLED"]).optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const listPlansQuerySchema = z
  .object({
    status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
    patientId: z.string().uuid().optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

// ---------- الجلسات ----------

export const createSessionSchema = z
  .object({
    title: cleanString(2, 120, "عنوان الجلسة قصير جدًا", "عنوان الجلسة طويل جدًا"),
    notes: cleanOptionalMultiline(2000, "الملاحظات طويلة جدًا"),
    plannedDate: dateOnly().nullable().optional(),
    appointmentId: z.string().uuid("موعد غير صالح").nullable().optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const updateSessionSchema = z
  .object({
    title: cleanString(2, 120, "عنوان الجلسة قصير جدًا", "عنوان الجلسة طويل جدًا").optional(),
    notes: cleanOptionalMultiline(2000, "الملاحظات طويلة جدًا"),
    plannedDate: dateOnly().nullable().optional(),
    // null = فكّ ربط الموعد.
    appointmentId: z.string().uuid("موعد غير صالح").nullable().optional(),
    status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]).optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

// ترتيب الجلسات: القائمة الكاملة لمعرّفات جلسات الخطة بالترتيب الجديد (عملية ذرّية واحدة).
export const reorderSessionsSchema = z
  .object({ sessionIds: z.array(z.string().uuid()).min(1).max(100) })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

// ---------- المتابعات ----------

// إمّا تاريخ محدد، أو «بعد N أشهر» (الافتراضي 6) من اليوم بتوقيت الجزائر.
export const createFollowUpSchema = z
  .object({
    dueDate: dateOnly().optional(),
    afterMonths: z.coerce.number().int().min(1).max(36).optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const updateFollowUpSchema = z
  .object({
    // SCHEDULED تُضبط فقط عبر «برمجة موعد عودة» (لا يدويًا). DUE تعيد فتح متابعة مُتجاهَلة.
    status: z.enum(["DUE", "COMPLETED", "DISMISSED"]).optional(),
    dueDate: dateOnly().optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

// ---------- موعد العودة ----------

export const followUpAppointmentSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD"),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "صيغة الوقت يجب أن تكون HH:mm"),
    // المستفيد: غياب الحقل = نفس مستفيد الموعد الأصلي. null = صاحب الحساب نفسه صراحةً.
    // معرّف = فرد عائلة آخر صراحةً (يجب أن يكون من عائلة نفس صاحب الحساب).
    familyMemberId: z.string().uuid("فرد عائلة غير صالح").nullable().optional(),
    notes: cleanOptionalMultiline(500, "الملاحظة طويلة جدًا (500 حرف كحد أقصى)"),
    treatmentPlanId: z.string().uuid().optional(),
    treatmentSessionId: z.string().uuid().optional(),
    dentalFollowUpId: z.string().uuid().optional(),
    // مفتاح منع التكرار (تولّده الواجهة مرة لكل نافذة): إعادة الإرسال تعيد نفس الموعد ولا تنشئ آخر.
    idempotencyKey: z.string().uuid("مفتاح الطلب غير صالح"),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const rescheduleSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD"),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "صيغة الوقت يجب أن تكون HH:mm"),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const doctorSlotsQuerySchema = z
  .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD") })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const patientPlansQuerySchema = z
  .object({ familyMemberId: z.union([z.literal("self"), z.string().uuid()]).optional() })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;
export type FollowUpAppointmentInput = z.infer<typeof followUpAppointmentSchema>;
export type RescheduleInput = z.infer<typeof rescheduleSchema>;
