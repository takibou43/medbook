import { t } from "../i18n/locale.ts";
// تسمية مختصرة وودّية لأقرب دور ("اليوم 16:30"، "غدًا 09:00"، أو التاريخ الكامل) —
// نفس منطق BookAppointment.tsx، مستخرج هنا حتى تعرضه بطاقة/ملف الطبيب أيضًا بلا تكرار.
import { arabicDate } from "./patientPresentation";
export function formatSlotLabel(dateStr: string, startTime: string): string {
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const diffDays = Math.round((Date.parse(dateStr.slice(0, 10) + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);

  if (diffDays === 0) return t("اليوم {0}", { "0": startTime });
  if (diffDays === 1) return t("غدًا {0}", { "0": startTime });
  return `${arabicDate(dateStr)} — ${startTime}`;
}
