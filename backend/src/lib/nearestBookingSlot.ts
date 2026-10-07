import { ALGERIA_OFFSET_MINUTES, BookedRange, generateAvailableSlots, isWithinWorkingHours, ScheduleBlock } from "./slots";

/** Automatic booking may start between grid slots when today's queue is empty. */
export function nearestBookingSlot(date: Date, schedules: ScheduleBlock[], booked: BookedRange[], duration: number, queueEmpty: boolean, nowMs = Date.now()): string | null {
  const localNow = new Date(nowMs + ALGERIA_OFFSET_MINUTES * 60000);
  const today = localNow.toISOString().slice(0, 10);
  const day = date.toISOString().slice(0, 10);
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const grid = generateAvailableSlots(date, schedules, booked, duration).sort();
  const from = day === today ? Math.ceil((localNow.getUTCHours() * 3600 + localNow.getUTCMinutes() * 60 + localNow.getUTCSeconds() + localNow.getUTCMilliseconds() / 1000) / 60) : 0;
  if (day < today) return null;
  if (day === today && queueEmpty) {
    for (let start = from; start + duration < 1440; start++) {
      const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
      if (isWithinWorkingHours(date, format(start), format(start + duration), schedules)
        && !booked.some(range => start < minutes(range.endTime) && minutes(range.startTime) < start + duration)) return format(start);
    }
    return null;
  }
  return grid.find(time => minutes(time) >= from) ?? null;
}
