import type { Role } from "../types/index.ts";

/**
 * مساعدات نقية للقائمة الجانبية (تُختبر بـnode --test): حفظ تفضيل الطي، الأحرف الأولى،
 * اسم الدور، وتقسيم الروابط بين الوسط والأسفل. لا طلبات شبكة ولا مؤقتات.
 */

export const SIDEBAR_COLLAPSED_KEY = "medbook_doctor_sidebar_collapsed";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** يقرأ تفضيل الطي؛ أي خطأ (وضع خاص، تخزين محظور) = موسّعة. */
export function readSidebarCollapsed(storage: StorageLike | null = safeStorage()): boolean {
  try {
    return storage?.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean, storage: StorageLike | null = safeStorage()): void {
  try {
    storage?.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* التفضيل اختياري: نتجاهل فشل الحفظ */
  }
}

/** حرفان أوليان من الاسم (أو من البريد عند غياب الاسم). */
export function initialsOf(name: string | undefined | null, fallback = "؟"): string {
  const parts = (name ?? "").trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = [...parts[0]][0] ?? "";
  const second = parts.length > 1 ? [...parts[1]][0] ?? "" : "";
  return (first + second).toUpperCase();
}

const ROLE_LABELS_AR: Record<Role, string> = {
  DOCTOR: "طبيب",
  ASSISTANT: "مساعد",
  ADMIN: "مدير المنصة",
  CLINIC_OWNER: "مدير عيادة",
  PATIENT: "مريض",
};

export function roleLabel(role: Role | undefined | null): string {
  return role ? ROLE_LABELS_AR[role] ?? "" : "";
}

interface AccountLike {
  role?: Role;
  email?: string;
  doctor?: { firstName?: string; lastName?: string } | null;
  patient?: { firstName?: string; lastName?: string } | null;
  ownedClinic?: { nameAr?: string } | null;
}

/** الاسم المعروض في بطاقة الحساب. */
export function accountDisplayName(user: AccountLike | null | undefined): string {
  if (!user) return "";
  const person = user.doctor ?? user.patient;
  const full = [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim();
  if (full) return user.role === "DOCTOR" ? `د. ${full}` : full;
  if (user.ownedClinic?.nameAr) return user.ownedClinic.nameAr;
  return user.email ?? "";
}

/** يقسم الروابط: الوسط (الأقسام) والأسفل (الإعدادات) مع حفظ الترتيب الأصلي. */
export function splitNavItems<T extends { footer?: boolean }>(items: T[]): { main: T[]; footer: T[] } {
  return { main: items.filter((i) => !i.footer), footer: items.filter((i) => i.footer) };
}
