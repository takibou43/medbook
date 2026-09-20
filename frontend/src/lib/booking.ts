import type { Doctor } from "../types";
import { API_MESSAGES, classifyApiError } from "./api";

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

// فرق الدقائق بين وقتي بداية ونهاية الموعد الفعليَّين (بصيغة HH:mm) كما سجّلهما الخادم —
// نستخدمها كمدة دقيقة للحدث في التقويم بدل افتراض مدة ثابتة.
export function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

// رابط "أضِف إلى التقويم" — يُنشأ بالكامل في المتصفح من بيانات الموعد الفعلية (بلا خادم
// إضافي وبلا أي مكتبة جديدة). نعتمد حاليًا على Google Calendar فقط كخيار مبسّط وموحّد يعمل
// من أي متصفح على Android وiOS دون تنزيل ملف. بتوقيت الجزائر UTC+1 (بلا توقيت صيفي).
export function buildGoogleCalendarUrl(params: {
  doctorName: string;
  patientName: string;
  clinicPhone: string | null;
  address: string | null;
  dateStr: string;
  startTime: string;
  durationMinutes: number;
}): string {
  const { doctorName, patientName, clinicPhone, address, dateStr, startTime, durationMinutes } = params;
  // نحلّل dateStr بمرونة: قد يصل كسلسلة "YYYY-MM-DD" فقط (كما في معاينة الدور) أو كطابع
  // زمني ISO كامل بالحرف T (كما في استجابة إنشاء الموعد الفعلي). نمرّ دائمًا عبر new Date()
  // ونقرأ مكوّناته بتوقيت UTC مباشرة، بصرف النظر عن الصيغة الواردة.
  const baseDate = new Date(dateStr);
  const [h, mi] = startTime.split(":").map(Number);
  const ALGERIA_OFFSET_MS = 60 * 60000;
  const startUtc = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), h, mi) - ALGERIA_OFFSET_MS
  );
  const endUtc = new Date(startUtc.getTime() + Math.max(durationMinutes, 5) * 60000);
  const fmt = (dt: Date) => dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const title = `موعد طبي مع الدكتور ${doctorName}`;
  const description = [
    "موعد طبي محجوز عبر MedBook",
    `الطبيب: د. ${doctorName}`,
    `المريض: ${patientName}`,
    clinicPhone ? `هاتف العيادة: ${clinicPhone}` : null,
  ]
    .filter((p): p is string => Boolean(p))
    .join(" | ");

  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${fmt(startUtc)}/${fmt(endUtc)}` +
    `&details=${encodeURIComponent(description)}` +
    (address ? `&location=${encodeURIComponent(address)}` : "")
  );
}

export function formatLongDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long" });
}

// "طبيب واحد" / "طبيبان" / "3 أطباء" / "12 طبيبًا" — صيغة العدد الصحيحة بالعربية.
export function doctorsCountLabel(n: number): string {
  if (n === 1) return "طبيب واحد";
  if (n === 2) return "طبيبان";
  if (n >= 3 && n <= 10) return `${n} أطباء`;
  return `${n} طبيبًا`;
}

export type BookingErrorKind = "network" | "conflict" | "notFound" | "forbidden" | "server" | "other";

// رسائل مفهومة للمريض بدل أخطاء تقنية ("Request failed with status code 500"…). رسائل الخادم العربية
// الخاصة بالحجز (تعارض الوقت 409، الطبيب غير موجود 404، تقييد الحجز 403) تُعرض كما هي لأنها كُتبت للمريض؛
// أما أعطال الشبكة والمهلة و429 و5xx فتُصنَّف بدقة عبر classifyApiError حتى لا يُلام إنترنت المريض خطأً.
export function bookingError(err: unknown, fallback = "تعذّر إتمام العملية. حاول مرة أخرى."): { kind: BookingErrorKind; message: string } {
  const e = err as any;
  const status: number | undefined = e?.response?.status;
  const serverMsg: string | undefined = typeof e?.response?.data?.message === "string" ? e.response.data.message : undefined;

  const { kind } = classifyApiError(err);
  if (kind === "offline" || kind === "network" || kind === "timeout") return { kind: "network", message: API_MESSAGES[kind] };
  if (kind === "server") return { kind: "server", message: API_MESSAGES.server };
  if (kind === "rateLimited") return { kind: "other", message: API_MESSAGES.rateLimited };
  if (status === 409) return { kind: "conflict", message: serverMsg ?? "هذا الموعد لم يعد متاحًا. سنعرض لك أقرب موعد متاح." };
  if (status === 404) return { kind: "notFound", message: serverMsg ?? "هذا الطبيب لم يعد متاحًا حاليًا." };
  if (status === 403) return { kind: "forbidden", message: serverMsg ?? fallback };
  return { kind: "other", message: serverMsg ?? fallback };
}
