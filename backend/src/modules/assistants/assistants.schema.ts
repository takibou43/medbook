import { z } from "zod";

export const inviteAssistantSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
});

export type InviteAssistantInput = z.infer<typeof inviteAssistantSchema>;
