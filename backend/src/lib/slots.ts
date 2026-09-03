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

// الجزائر بتوقيت UTC+1 طوال السنة (لا يوجد توقيت صيفي) — نطبّق هذه الإزاحة يدويًا
// بدل الاعتماد على التوقيت المحلي لعملية Node.js، لأن خوادم الاستضافة (Render) تعمل
// عادة بتوقيت UTC، فلو استعملنا setHours()/getDay() المحلية لَفَسَّرنا "08:00" التي
// أدخلها الطبيب على أنها 08:00 UTC (= 09:00 بتوقيت الجزائر) فينزاح كل الحساب بساعة كاملة.
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

// نقارن أيام التقويم دائمًا عبر حقول UTC (وليس المحلية) لأن كل تواريخنا مخزَّنة
// كمنتصف ليل UTC يمثّل اليوم بتوقيت الجزائر (انظر algeriaTodayUTCMidnight أدناه).
function sameCalendarDay(a: Date, b: Date): boolean {
    return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** اللحظة الحالية، لكن بحقول UTC تعكس ساعة حائط الجزائر (بغضّ النظر عن توقيت الخادم). */
function algeriaNowShifted(): Date {
    return new Date(Date.now() + ALGERIA_OFFSET_MINUTES * 60000);
}

/** "اليوم" بتوقيت الجزائر، كمنتصف ليل مخزَّن بصيغة UTC — مرجع موحّد لكل حسابات التواريخ. */
export function algeriaTodayUTCMidnight(): Date {
    const n = algeriaNowShifted();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 0, 0, 0));
}

/**
 * يرجع قائمة الفترات المتاحة (مثل "09:00") لطبيب في تاريخ محدد،
 * مع استبعاد الفترات المحجوزة مسبقًا (PENDING/CONFIRMED) وفترات الراحة/العطل.
 */
export function generateAvailableSlots(
    date: Date,
    schedules: ScheduleBlock[],
    bookedRanges: BookedRange[],
    slotMinutes = DEFAULT_SLOT_MIN
  ): string[] {
    const dayOfWeek = date.getUTCDay();

  // 1) هل يوجد استثناء (يوم عطلة استثنائي) لهذا التاريخ بالذات؟
  const dayException = schedules.find((s) => s.isException && s.exceptionDate && sameCalendarDay(s.exceptionDate, date) && s.isOff);
    if (dayException) return [];

  // 2) الفترات المعتمدة: الفترات الأسبوعية العادية + أي فترات استثنائية إضافية لنفس اليوم (وليست off)
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

/** يتحقق أن فترة زمنية محددة (startTime) تقع فعليًا ضمن أوقات عمل الطبيب في ذلك التاريخ. */
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

export function isPast(date: Date, startTime: string): boolean {
    const [h, m] = startTime.split(":").map(Number);
    // date يمثّل منتصف ليل ذلك اليوم (مخزَّن UTC، لكنه يقابل اليوم بتوقيت الجزائر).
  // نبني اللحظة الحقيقية UTC لبداية الفترة بإضافة الوقت اليومي ثم طرح إزاحة الجزائر (+1)،
  // بدل dt.setHours() المحلية التي كانت تُفسَّر بتوقيت الخادم (UTC على Render) فتُنتج
  // فارقًا بساعة كاملة عن ساعة حائط الجزائر الفعلية — وهو سبب المشكلة المُبلَّغ عنها
  // (حجز مريض في الساعة 15 وحصوله على دور الساعة 14).
  const slotUtcMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m, 0, 0) - ALGERIA_OFFSET_MINUTES * 60000;
    return slotUtcMs < Date.now();
}
