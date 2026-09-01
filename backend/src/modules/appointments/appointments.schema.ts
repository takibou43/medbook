import { z } from "zod";

export const createAppointmentSchema = z.object({
  doctorId: z.string().uuid("طبيب غير صالح"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "صيغة الوقت يجب أن تكون HH:mm"),
  type: z.enum(["IN_PERSON", "FOLLOW_UP", "ONLINE"]).default("IN_PERSON"),
  notes: z.string().max(1000).optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
