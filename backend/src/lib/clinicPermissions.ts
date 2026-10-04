import { z } from "zod";

export const CLINIC_PERMISSIONS = ["EDIT_PROFILE", "MANAGE_TERMS", "VIEW_FINANCE", "MANAGE_ASSISTANT_STATUS"] as const;
export type ClinicPermission = typeof CLINIC_PERMISSIONS[number];
export const managerPermissionsSchema = z.object({
  isManager: z.boolean(),
  permissions: z.array(z.enum(CLINIC_PERMISSIONS)).max(CLINIC_PERMISSIONS.length).default([]),
}).strict();

export const assistantScopeSchema = z.object({
  allDoctors: z.boolean(),
  doctorIds: z.array(z.string().uuid()).max(1000).default([]),
}).strict();
