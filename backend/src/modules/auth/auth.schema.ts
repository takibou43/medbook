import { z } from "zod";

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
  specialtyId: z.string().uuid("التخصص مطلوب"),
  wilayaId: z.string().uuid("الولاية مطلوبة"),
  cityId: z.string().uuid("المدينة مطلوبة"),
  clinicId: z.string().uuid().optional(),
  bio: z.string().optional(),
  yearsExperience: z.coerce.number().int().min(0).optional(),
  languages: z.array(z.string()).optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  consultationFee: z.coerce.number().int().min(0).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

export type RegisterPatientInput = z.infer<typeof registerPatientSchema>;
export type RegisterDoctorInput = z.infer<typeof registerDoctorSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
