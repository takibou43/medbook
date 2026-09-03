/**
 * منطق توليد الفترات الزمنية المتاحة لطبيب معيّن في يوم محدد.
 * يُستخدم من صفحة توفر الطبيب (Availability) ومن نظام الحجز لمنع التعارض (Double Booking).
 */

export interface ScheduleBlock {
      dayOfWeek: number | null;
      startTime: string; // "08:00"
  endTime: string; // "12:00"
  isException: boolean;
      exceptionDate: Date | null;
      isOff: boolean;
}

export interface BookedRange {
      startTime: string;
      endTime: string;
}

const DEFAULT_SLOT_MIN = 20;

export const ALGERIA_OFFSET_MINUTES = 60;

function toMinutes(hhmm: string): number {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
}

function toHHMM(mins: number): string {
      const h = Math.floor(mins / 60)
        .toString()
        .padStart(2, "0");
      const m = (mins % 60).toString().padStart(2, "0");
      return `${h}:${m}`;
}

function sameCalendarDay(a: Date, b: Date): boolean {
      return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function algeriaNowShifted(): Date {
      return new Date(Date.now() + ALGERIA_OFFSET_MINUTES * 60000);
}

export function algeriaTodayUTCMidnight(): Date {
      const n = algeriaNowShifted();
      return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 0, 0, 0));
}

export function generateAvailableSlots(
      date: Date,
      schedules: ScheduleBlock[],
      bookedRanges: BookedRange[],
      slotMinutes = DEFAULT_SLOT_MIN
    ): string[] {
      const dayOfWeek = date.getUTCDay();

  const dayException = schedules.find((s) => s.isException && s.exceptionDate && sameCalendarDay(s.exceptionDate, date) && s.isOff);
      if (dayException) return [];

  const applicable = schedules.filter((s) => {
          if (s.isException) {
                    return s.exceptionDate && sameCalendarDay(s.exceptionDate, date) && !s.isOff;
          }
          return s.dayOfWeek === dayOfWeek && !s.isOff;
  });

  if (applicable.length === 0) return [];

  const bookedMinuteRanges = bookedRanges.map((b) => [toMinutes(b.startTime), toMinutes(b.endTime)] as const);

  const slots: string[] = [];
      for (const block of applicable) {
              let cursor = toMinutes(block.startTime);
              const end = toMinutes(block.endTime);
              while (cursor + slotMinutes <= end) {
                        const slotStart = cursor;
                        const slotEnd = cursor + slotMinutes;
                        const overlaps = bookedMinuteRanges.some(([bStart, bEnd]) => slotStart < bEnd && bStart < slotEnd);
                        if (!overlaps) slots.push(toHHMM(slotStart));
                        cursor += slotMinutes;
              }
      }

  return slots;
}

export function isWithinWorkingHours(date: Date, startTime: string, endTime: string, schedules: ScheduleBlock[]): boolean {
      const dayOfWeek = date.getUTCDay();

  const dayException = schedules.find((s) => s.isException && s.exceptionDate && sameCalendarDay(s.exceptionDate, date) && s.isOff);
      if (dayException) return false;

  const applicable = schedules.filter((s) => {
          if (s.isException) {
                    return s.exceptionDate && sameCalendarDay(s.exceptionDate, date) && !s.isOff;
          }
          return s.dayOfWeek === dayOfWeek && !s.isOff;
  });

  const start = toMinutes(startTime);
      const end = toMinutes(endTime);
      return applicable.some((b) => toMinutes(b.startTime) <= start && end <= toMinutes(b.endTime));
}

export function closingTimeForDate(date: Date, schedules: ScheduleBlock[]): string | null {
      const dayOfWeek = date.getUTCDay();

  const dayException = schedules.find((s) => s.isException && s.exceptionDate && sameCalendarDay(s.exceptionDate, date) && s.isOff);
      if (dayException) return null;

  const applicable = schedules.filter((s) => {
          if (s.isException) {
                    return s.exceptionDate && sameCalendarDay(s.exceptionDate, date) && !s.isOff;
          }
          return s.dayOfWeek === dayOfWeek && !s.isOff;
  });
      if (applicable.length === 0) return null;

  let maxEnd = 0;
      for (const b of applicable) maxEnd = Math.max(maxEnd, toMinutes(b.endTime));
      return toHHMM(maxEnd);
}

export function isPast(date: Date, startTime: string): boolean {
      const [h, m] = startTime.split(":").map(Number);
      const slotUtcMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m, 0, 0) - ALGERIA_OFFSET_MINUTES * 60000;
      return slotUtcMs < Date.now();
}
