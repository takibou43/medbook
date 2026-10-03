import type { AccountProfiles } from "../types";

/**
 * الانتقال بين واجهتي المرضى والأطباء لحساب يملك الملفين.
 * لا يمرّ أي رمز سري في رابط: الانتقال استدعاء مصادَق بـBearer يضبط كوكي الجلسة في الخادم، ثم يفتح الموقع
 * الآخر برابط يحمل علامة غير سرية فقط (?switch=1) تُخبره أن يحاول إنشاء جلسته من الكوكي.
 */
export const SWITCH_PARAM = "switch";

export function hasBothProfiles(profiles?: Pick<AccountProfiles, "patient" | "doctor"> | null): boolean {
  return !!profiles && profiles.patient && !!profiles.doctor;
}

/** جسم طلب الخروج: حساب الملفين يخرج من الواجهتين معًا. */
export function logoutBody(profiles?: Pick<AccountProfiles, "patient" | "doctor"> | null): { allSessions?: true } {
  return hasBothProfiles(profiles) ? { allSessions: true } : {};
}

/** رابط الموقع الآخر مع علامة الانتقال. يقبل أصلًا مطلقًا فقط (http/https) وإلا يعيد "/" كي لا تُبنى وجهة غريبة. */
export function portalUrl(base: string, path = "/"): string {
  let origin: string;
  try {
    const u = new URL(base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "/";
    origin = u.origin;
  } catch {
    return "/";
  }
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `${origin}${safePath}?${SWITCH_PARAM}=1`;
}

export function wantsSessionBootstrap(search: string): boolean {
  return new URLSearchParams(search).get(SWITCH_PARAM) === "1";
}

export function withoutSwitchParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SWITCH_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
