import { z } from "zod";

// البريد يُطبَّع دائمًا (trim + lowercase) قبل أي تحقق أو بحث أو حفظ، فلا يمكن إنشاء حسابين
// لـ "Ali@Mail.com" و "ali@mail.com".
const email = z
  .string({ required_error: "البريد الإلكتروني مطلوب" })
  .trim()
  .toLowerCase()
  .max(254, "البريد الإلكتروني طويل جدًا")
  .email("بريد إلكتروني غير صالح");

export const patientRegisterSchema = z.object({
  email,
  // حد أعلى 128: bcrypt يتجاهل ما بعد 72 بايتًا، والحد يمنع إرسال نصوص ضخمة لإرهاق الخادم.
  password: z
    .string({ required_error: "كلمة المرور مطلوبة" })
    .min(8, "كلمة المرور يجب أن تكون 8 خانات على الأقل")
    .max(128, "كلمة المرور طويلة جدًا"),
  name: z.string({ required_error: "الاسم مطلوب" }).trim().min(2, "الاسم قصير جدًا").max(120, "الاسم طويل جدًا"),
  // نفس قاعدة الحجز (booking.schema.ts): رقم جزائري 05/06/07 + 8 أرقام. اختياري.
  phone: z
    .string()
    .trim()
    .regex(/^0[5-7][0-9]{8}$/, "رقم هاتف جزائري غير صالح (مثال: 0551234567)")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const patientLoginSchema = z.object({
  email,
  password: z.string({ required_error: "كلمة المرور مطلوبة" }).min(1, "كلمة المرور مطلوبة").max(128),
});

// اشتراك Push كما يُرجعه PushSubscription.toJSON() في المتصفح. endpoint يجب أن يكون https
// (خدمات الدفع الحقيقية كلها https)، والمفاتيح بصيغة base64url بطول معقول.
const b64url = /^[A-Za-z0-9_-]+=*$/;
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("https://"), "عنوان اشتراك غير صالح"),
  keys: z.object({
    p256dh: z.string().min(16).max(256).regex(b64url, "مفتاح غير صالح"),
    auth: z.string().min(8).max(128).regex(b64url, "مفتاح غير صالح"),
  }),
});

export const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export type PatientRegisterInput = z.infer<typeof patientRegisterSchema>;
export type PatientLoginInput = z.infer<typeof patientLoginSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
