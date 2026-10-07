import { z } from "zod";
import { specialtyNameSchema } from "../../lib/specialtySelection";

export const registerPatientSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  phone: z.string().min(9, "رقم الهاتف غير صالح").optional(),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 خانات على الأقل"),
  firstName: z.string().min(2, "الاسم قصير جدًا"),
  lastName: z.string().min(2, "اللقب قصير جدًا"),
  birthDate: z.coerce.date().optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  cityId: z.string().uuid().optional(),
});

export const registerDoctorSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  phone: z.string().min(9, "رقم الهاتف غير صالح").optional(),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 خانات على الأقل"),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  specialtyId: z.string().uuid("التخصص مطلوب").optional(),
  specialtyName: specialtyNameSchema.optional(),
  wilayaId: z.string().uuid("الولاية مطلوبة"),
  cityId: z.string().uuid("المدينة مطلوبة"),
  clinicId: z.string().uuid().optional(),
  bio: z.string().optional(),
  yearsExperience: z.coerce.number().int().min(0).optional(),
  languages: z.array(z.string()).optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  consultationFee: z.coerce.number().int().min(0).optional(),
  // كود إحالة زميل (اختياري). فارغ = بلا إحالة. غير صحيح → 400 مرتبط بالحقل (لا يُنشأ الحساب حتى يُصحَّح أو يُحذف).
  referralCode: z.string().trim().max(20, "كود الإحالة غير صحيح").optional(),
});

// تسجيل حساب مساعد — لا يُختار الدور أبدًا من الواجهة؛ رمز الدعوة (token) هو ما يحدد
// البريد المسموح والطبيب الذي سيُربط به المساعد تلقائيًا (انظر assistants.service.acceptInvite).
export const registerAssistantSchema = z.object({
  token: z.string().min(10, "رابط الدعوة غير صالح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 خانات على الأقل"),
  firstName: z.string().min(2, "الاسم قصير جدًا"),
  lastName: z.string().min(2, "اللقب قصير جدًا"),
});

export const loginSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

// تغيير بيانات الحساب: كلمة المرور الحالية مطلوبة دائمًا.
// ملاحظة: لا نستعمل .refine() هنا لأن middleware الـ validate يقبل ZodObject فقط
// (‏.refine تُرجع ZodEffects)؛ شرط "تغيير واحد على الأقل" مطبَّق في الخدمة (updateAccount).
export const updateAccountSchema = z
  .object({
    currentPassword: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
    email: z.string().trim().email("بريد إلكتروني غير صالح").max(254).optional(),
    newPassword: z.string().min(8, "كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل").optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

// تفعيل ملف مريض لحساب طبيب قائم. كلمة المرور تُطلب من جديد (إثبات حضور) فلا تكفي جلسة مسروقة
// لإضافة ملف. لا بريد ولا هاتف هنا إطلاقًا: الحساب هو نفسه ببريده وهاتفه.
export const addPatientProfileSchema = z
  .object({
    password: z.string().min(1, "كلمة المرور مطلوبة").max(128),
    firstName: z.string().trim().min(2, "الاسم قصير جدًا").max(60).optional(),
    lastName: z.string().trim().min(2, "اللقب قصير جدًا").max(60).optional(),
    cityId: z.string().uuid("البلدية غير صالحة").optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

// طلب تسجيل كطبيب من حساب مريض قائم: بيانات الطبيب المهنية فقط + كلمة المرور الحالية.
// لا بريد ولا هاتف ولا clinicId (الانضمام إلى العيادة بدعوة) ولا أي حقل اعتماد/اشتراك.
export const applyDoctorProfileSchema = z
  .object({
    password: z.string().min(1, "كلمة المرور مطلوبة").max(128),
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().min(2).max(60),
    specialtyId: z.string().uuid("التخصص مطلوب"),
    wilayaId: z.string().uuid("الولاية مطلوبة"),
    cityId: z.string().uuid("المدينة مطلوبة"),
    bio: z.string().max(2000).optional(),
    yearsExperience: z.coerce.number().int().min(0).max(80).optional(),
    languages: z.array(z.string().max(40)).max(10).optional(),
    gender: z.enum(["MALE", "FEMALE"]).optional(),
    consultationFee: z.coerce.number().int().min(0).optional(),
    referralCode: z.string().trim().max(20, "كود الإحالة غير صحيح").optional(),
  })
  .strict("يحتوي الطلب على حقول غير مسموح بها.");

export const logoutSchema = z.object({ allSessions: z.boolean().optional() }).strict();

export type AddPatientProfileInput = z.infer<typeof addPatientProfileSchema>;
export type ApplyDoctorProfileInput = z.infer<typeof applyDoctorProfileSchema>;
export type RegisterPatientInput = z.infer<typeof registerPatientSchema>;
export type RegisterDoctorInput = z.infer<typeof registerDoctorSchema>;
export type RegisterAssistantInput = z.infer<typeof registerAssistantSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
