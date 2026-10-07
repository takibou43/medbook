import { z } from "zod";
import { inviteTermsFields } from "../../lib/clinicFinance";
import { specialtyNameSchema } from "../../lib/specialtySelection";
export const clinicProfileSchema = z.object({
  nameAr: z.string().trim().min(2).max(150),
  address: z.string().trim().min(3).max(500),
  phone: z.string().trim().min(9).max(20).optional(),
  wilayaId: z.string().uuid(), cityId: z.string().uuid(),
  description: z.string().trim().max(2000).optional(),
  photoUrl: z.string().url().max(1000).startsWith("https://").optional(),
}).strict();
export const clinicDoctorProfileSchema = z.object({
  firstName: z.string().trim().min(2).max(100), lastName: z.string().trim().min(2).max(100),
  specialtyId: z.string().uuid().optional(), specialtyName: specialtyNameSchema.optional(), gender: z.enum(["MALE", "FEMALE"]).optional(),
  yearsExperience: z.coerce.number().int().min(0).max(80).optional(),
  bio: z.string().trim().max(2000).optional(),
  consultationFee: z.coerce.number().int().min(0).optional(),
}).strict();
export const registerClinicSchema = z.object({
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(8).max(128),
  clinic: clinicProfileSchema,
  doctor: clinicDoctorProfileSchema.optional(),
}).strict();
export const acceptClinicInviteSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(8).max(128),
  doctor: clinicDoctorProfileSchema,
}).strict();
export const clinicIdParams = z.object({ id: z.string().uuid() }).strict();
export const emailInviteSchema = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()) }).strict();
// دعوة طبيب للعيادة: البريد + شروط اختيارية (سعر الموعد ونسبة الطبيب) يحددها المدير. نسبة العيادة مرفوضة (تُحسب).
export const clinicInviteSchema = z.object({
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  ...inviteTermsFields,
}).strict();
export const financeRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const clinicSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  wilayaId: z.string().uuid().optional(), cityId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
}).strict();
export type ClinicProfileInput = z.infer<typeof clinicProfileSchema>;
