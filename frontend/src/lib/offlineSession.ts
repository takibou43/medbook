import type { Role, User } from "../types/index.ts";

const KEY = "medbook_offline_user_v1";
interface OfflineUser { id: string; role: Role; firstName?: string; lastName?: string; }

export function saveOfflineUser(user: User) {
  if (user.role !== "PATIENT") return clearOfflineUser();
  const value: OfflineUser = { id: user.id, role: user.role, firstName: user.patient?.firstName, lastName: user.patient?.lastName };
  localStorage.setItem(KEY, JSON.stringify(value));
}

export function loadOfflineUser(): User | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.id !== "string" || value.role !== "PATIENT" ||
      (value.firstName !== undefined && typeof value.firstName !== "string") ||
      (value.lastName !== undefined && typeof value.lastName !== "string")) throw new Error();
    return { id: value.id, role: "PATIENT", email: "", isActive: true,
      patient: { id: "", firstName: (value.firstName as string | undefined) ?? "", lastName: (value.lastName as string | undefined) ?? "" } };
  } catch { clearOfflineUser(); return null; }
}

export function clearOfflineUser() { localStorage.removeItem(KEY); }
