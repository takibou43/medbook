import { AppointmentStatus } from "@prisma/client";
import { ALGERIA_OFFSET_MINUTES } from "./slots";

/**
 * قيود التوقيت على تغيير حالة موعد من طرف الطبيب/المساعد/الإدارة — دالة نقية تُختبر بوقت ثابت.
 *
 * المعاني المعتمدة في المشروع (بلا تغيير):
 *  - COMPLETED («اكتمل الموعد»، الزر الذي كان اسمه «حضر»): المريض دخل وأنهى استشارته.
 *  - IN_PROGRESS: المريض بالداخل الآن أمام الطبيب.
 *  - NO_SHOW: لم يحضر إلى موعده.
 *
 * القيود (الحد الأدنى الضروري، تُطبَّق في الخادم ولا تكتفي الواجهة بتعطيل الزر):
 *  1) لا «لم يحضر» قبل حلول وقت الموعد — إلا لمريض نودي عليه فعلًا اليوم (IN_PROGRESS/LATE).
 *  2) لا «اكتمل الموعد» لموعد في يوم لاحق (لم يأتِ يومه بعد)، ولا لموعد مؤكد اليوم قبل حلول ساعته —
 *     إلا لمريض نودي عليه فعلًا اليوم (IN_PROGRESS/LATE) فيجوز إكماله حتى لو كان وقته الأصلي لاحقًا.
 *  3) لا «بالداخل الآن» (IN_PROGRESS) إلا يوم الموعد نفسه — نفس منطق الطابور اليومي.
 * الإلغاء والتأكيد غير مقيّدين بالتوقيت.
 */
export function appointmentStartUtcMs(date: Date, startTime: string): number {
  const [h, m] = startTime.split(":").map(Number);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m || 0, 0, 0) - ALGERIA_OFFSET_MINUTES * 60000;
}

function algeriaDayKey(nowMs: number): string {
  return new Date(nowMs + ALGERIA_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}

export function statusTimingError(
  appointment: { date: Date; startTime: string; status: AppointmentStatus },
  newStatus: AppointmentStatus,
  nowMs: number
): string | null {
  const day = appointment.date.toISOString().slice(0, 10);
  const today = algeriaDayKey(nowMs);
  const isFutureDay = day > today;

  if (newStatus === AppointmentStatus.NO_SHOW) {
    const calledToday =
      day === today && (appointment.status === AppointmentStatus.IN_PROGRESS || appointment.status === AppointmentStatus.LATE);
    if (!calledToday && appointmentStartUtcMs(appointment.date, appointment.startTime) > nowMs) {
      return `لا يمكن تسجيل «لم يحضر» قبل حلول وقت الموعد (${appointment.startTime}).`;
    }
  }
  if (newStatus === AppointmentStatus.COMPLETED && isFutureDay) {
    return "لا يمكن إنهاء موعد لم يحن يومه بعد.";
  }
  if (newStatus === AppointmentStatus.COMPLETED && day === today) {
    const calledToday = appointment.status === AppointmentStatus.IN_PROGRESS || appointment.status === AppointmentStatus.LATE;
    if (!calledToday && appointmentStartUtcMs(appointment.date, appointment.startTime) > nowMs) {
      return `لا يمكن إنهاء الموعد قبل حلول وقته (${appointment.startTime}) ما لم يُستدعَ المريض فعليًا.`;
    }
  }
  if (newStatus === AppointmentStatus.IN_PROGRESS && day !== today) {
    return isFutureDay ? "لا يمكن إدخال مريض موعده في يوم لاحق." : "لا يمكن إدخال مريض موعده في يوم سابق.";
  }
  return null;
}
