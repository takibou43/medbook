import { z } from "zod";

export const adminAccountInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12, "كلمة مرور الإدارة يجب ألا تقل عن 12 خانة.").max(128),
  phone: z.string().regex(/^0[5-7]\d{8}$/, "رقم هاتف جزائري غير صالح.").optional(),
}).strict();
