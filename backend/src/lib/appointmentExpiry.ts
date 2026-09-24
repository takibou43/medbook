import { ALGERIA_OFFSET_MINUTES } from "./slots";

/**
 * متى تنتهي صلاحية إشعارات موعد ما؟ عند نهاية يوم الموعد بتوقيت الجزائر (UTC+1 ثابت، بلا توقيت صيفي —
 * نفس القاعدة المستعملة في lib/slots.ts والتذكيرات).
 *
 * عمود appointments.date يحمل يوم الموعد كـ"منتصف الليل UTC" لتاريخ الجزائر (مثلاً 2026-09-24T00:00Z
 * = يوم 24 بتوقيت الجزائر). نهاية هذا اليوم = منتصف ليل الجزائر التالي = 2026-09-24T23:00Z.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = ALGERIA_OFFSET_MINUTES * 60 * 1000;

export function appointmentDayEndsAt(appointmentDate: Date): Date {
  const dayStartUtcMidnight = Date.UTC(
    appointmentDate.getUTCFullYear(),
    appointmentDate.getUTCMonth(),
    appointmentDate.getUTCDate()
  );
  return new Date(dayStartUtcMidnight + DAY_MS - OFFSET_MS);
}

/** هل انتهى يوم الموعد (بتوقيت الجزائر) عند اللحظة now؟ */
export function isAppointmentDayOver(appointmentDate: Date, now: Date = new Date()): boolean {
  return now.getTime() >= appointmentDayEndsAt(appointmentDate).getTime();
}

/** الوسم الموحّد لإشعارات موعد واحد على الهاتف: إشعار جديد لنفس الموعد يستبدل السابق بدل أن يتراكم. */
export function appointmentNotificationTag(appointmentId: string): string {
  return `appt-${appointmentId}`;
}
