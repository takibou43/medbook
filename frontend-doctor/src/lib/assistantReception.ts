import { t } from "../i18n/locale.ts";
import type { Appointment, AppointmentStatus } from "../types";

export const RECEPTION_STATUSES: Record<AppointmentStatus, string> = {
  PENDING: "بانتظار التأكيد", CONFIRMED: "مؤكد — ينتظر", LATE: "متأخر — ينتظر",
  IN_PROGRESS: "تم نداؤه", COMPLETED: "مكتمل", CANCELLED: "ملغى",
  NO_SHOW: "لم يحضر", RESCHEDULE_REQUIRED: "يحتاج إعادة جدولة",
};
export type ReceptionFilter = { doctorId: string; status: string; search: string };
export function receptionLabel(a: Appointment) {
  if ((a.status === "CONFIRMED" || a.status === "LATE") && a.arrivedAt) return t("وصل — ينتظر");
  // IN_PROGRESS is written by calling, not by a distinct examination-start event.
  if (a.status === "IN_PROGRESS" && !a.calledAt) return t("قيد المتابعة — توقيت النداء غير متاح");
  return RECEPTION_STATUSES[a.status];
}
export function canMarkUnanswered(a: Appointment) {
  return a.status === "IN_PROGRESS" && Boolean(a.calledAt);
}
export function canOfferNoShow(a: Appointment) {
  return (a.status === "CONFIRMED" || a.status === "LATE") && !a.arrivedAt;
}
/** Send a draft only after two real calls and no recorded arrival; never mutate the booking. */
export function canSendAttendanceMessage(a: Appointment) {
  return (a.callCount ?? 0) >= 2 && !a.arrivedAt && Boolean(a.calledAt)
    && (a.status === "IN_PROGRESS" || a.status === "LATE");
}
/** Deferral is available only for today's absent waiting patients or a timed call. */
export function canMarkLate(a: Appointment, today: string) {
  return a.date.slice(0, 10) === today && !a.arrivedAt
    && (canOfferNoShow(a) || canMarkUnanswered(a));
}
export function filterReception<T extends Appointment>(rows: T[], filter: ReceptionFilter, name: (a: T) => string): T[] {
  const search = filter.search.trim().normalize("NFKC").toLocaleLowerCase();
  return rows.filter(a => (!filter.doctorId || a.doctorId === filter.doctorId)
    && (!filter.status || (filter.status === "ARRIVED" ? Boolean(a.arrivedAt) && (a.status === "CONFIRMED" || a.status === "LATE") : a.status === filter.status))
    && (!search || name(a).normalize("NFKC").toLocaleLowerCase().includes(search)));
}
/** Keep doctors grouped and use the server's actual next-call order inside each queue. */
export function orderReception<T extends Appointment>(rows: T[], doctors: { id: string; order: string[] }[]): T[] {
  const ranks = new Map(doctors.map((d, i) => [d.id, { group: i, positions: new Map(d.order.map((id, p) => [id, p])) }]));
  return [...rows].sort((a, b) => {
    const current = Number(b.status === "IN_PROGRESS") - Number(a.status === "IN_PROGRESS");
    if (current) return current;
    const da = ranks.get(a.doctorId), db = ranks.get(b.doctorId);
    const group = (da?.group ?? doctors.length) - (db?.group ?? doctors.length);
    if (group) return group;
    const rank = (x: Appointment) => x.status === "IN_PROGRESS" ? -1 : ranks.get(x.doctorId)?.positions.get(x.id) ?? Number.MAX_SAFE_INTEGER;
    return rank(a) - rank(b) || a.startTime.localeCompare(b.startTime);
  });
}
export function receptionTime(value: string) { return value.slice(0, 5); }
export function callTime(value: string) {
  return new Date(value).toLocaleTimeString("en-GB", { timeZone: "Africa/Algiers", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function callAge(value: string, now: number) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  return minutes === 0 ? t("نودي منذ أقل من دقيقة") : t("نودي منذ {0} دقيقة", { "0": minutes });
}
export function receptionConnection(queueAt: number, appointmentsAt: number, failed: boolean, now: number) {
  if (failed) return t("انقطع التحديث — البيانات المعروضة قديمة");
  if (!queueAt || !appointmentsAt) return t("جارٍ الاتصال…");
  const seconds = Math.max(0, Math.floor((now - Math.min(queueAt, appointmentsAt)) / 1000));
  if (seconds > 60) return t("التحديث متأخر — تحقق من الاتصال");
  return t("متصل — آخر تحديث منذ {0} ثانية", { "0": seconds });
}
