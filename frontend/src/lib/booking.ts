import { t } from "../i18n/locale.ts";
import type { Doctor } from "../types";
import { API_MESSAGES, classifyApiError } from "./api";
import { arabicDate } from "./patientPresentation";

// عنوان عيادة الطبيب الظاهر للمريض عند الحجز — عنوان العيادة أدق من العنوان الشخصي
// للطبيب إن وُجدت عيادة مسجَّلة، وإلا نستعمل عنوان الطبيب نفسه إن أدخله.
export function doctorAddress(d: Doctor): string | null {
  return d.clinic?.address || d.address || null;
}

// نفس قاعدة الخادم (booking.schema.ts): الاسم واللقب كل منهما حرفان على الأقل، والهاتف
// جزائري 05/06/07 + 8 أرقام. الهاتف اختياري كما كان في الاستمارة السابقة.
export const PHONE_REGEX = /^0[5-7][0-9]{8}$/;

// الخادم يستقبل firstName وlastName منفصلين؛ الواجهة تعرض حقلًا واحدًا "الاسم واللقب".
// أول كلمة = الاسم، وما بعدها = اللقب (مثال: "محمد بن علي" → الاسم "محمد" واللقب "بن علي").
export function splitFullName(full: string): { firstName: string; lastName: string } | null {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  if (firstName.length < 2 || lastName.length < 2) return null;
  if (firstName.length > 60 || lastName.length > 60) return null;
  return { firstName, lastName };
}

export function formatLongDate(dateStr: string): string {
  return arabicDate(dateStr);
}

// "طبيب واحد" / "طبيبان" / "3 أطباء" / "12 طبيبًا" — صيغة العدد الصحيحة بالعربية.
export function doctorsCountLabel(n: number): string {
  if (n === 1) return t("طبيب واحد");
  if (n === 2) return t("طبيبان");
  if (n >= 3 && n <= 10) return t("{0} أطباء", { "0": n });
  return t("{0} طبيبًا", { "0": n });
}

export type BookingErrorKind = "network" | "conflict" | "notFound" | "forbidden" | "server" | "other";

// رسائل مفهومة للمريض بدل أخطاء تقنية ("Request failed with status code 500"…). رسائل الخادم العربية
// الخاصة بالحجز (تعارض الوقت 409، الطبيب غير موجود 404، تقييد الحجز 403) تُعرض كما هي لأنها كُتبت للمريض؛
// أما أعطال الشبكة والمهلة و429 و5xx فتُصنَّف بدقة عبر classifyApiError حتى لا يُلام إنترنت المريض خطأً.
export function bookingError(err: unknown, fallback = t("تعذّر إتمام العملية. حاول مرة أخرى.")): { kind: BookingErrorKind; message: string } {
  const e = err as any;
  const status: number | undefined = e?.response?.status;
  const serverMsg: string | undefined = typeof e?.response?.data?.message === "string" ? e.response.data.message : undefined;

  const { kind } = classifyApiError(err);
  if (kind === "offline" || kind === "network" || kind === "timeout") return { kind: "network", message: API_MESSAGES[kind] };
  if (kind === "server") return { kind: "server", message: API_MESSAGES.server };
  if (kind === "rateLimited") return { kind: "other", message: API_MESSAGES.rateLimited };
  if (status === 409) return { kind: "conflict", message: serverMsg ?? t("هذا الموعد لم يعد متاحًا. سنعرض لك أقرب موعد متاح.") };
  if (status === 404) return { kind: "notFound", message: serverMsg ?? t("هذا الطبيب لم يعد متاحًا حاليًا.") };
  if (status === 403) return { kind: "forbidden", message: serverMsg ?? fallback };
  return { kind: "other", message: serverMsg ?? fallback };
}
