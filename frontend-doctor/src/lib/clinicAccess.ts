import type { User } from "../types/index.ts";

export const clinicPermissions = [
  { value: "EDIT_PROFILE", label: "تعديل بيانات العيادة" },
  { value: "MANAGE_TERMS", label: "ضبط أسعار الأطباء ونسبهم" },
  { value: "VIEW_FINANCE", label: "عرض تقرير الإيرادات" },
  { value: "MANAGE_ASSISTANT_STATUS", label: "تفعيل وتعطيل المساعدين" },
] as const;

export function canManageClinic(user: Pick<User, "id" | "role" | "ownedClinic" | "doctor"> | null | undefined): boolean {
  if (!user || !["DOCTOR", "CLINIC_OWNER"].includes(user.role)) return false;
  return !!user.ownedClinic || user.doctor?.clinic?.ownerId === user.id ||
    (!!user.doctor?.clinic && user.doctor.clinicManagerForId === user.doctor.clinic.id);
}

export function canOpenClinic(user: Parameters<typeof canManageClinic>[0]): boolean {
  return canManageClinic(user) || (!!user && ["DOCTOR", "CLINIC_OWNER"].includes(user.role) && !user.doctor?.clinic);
}
