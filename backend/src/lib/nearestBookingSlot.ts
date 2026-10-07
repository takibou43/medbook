import { ALGERIA_OFFSET_MINUTES, BookedRange, generateAvailableSlots, isWithinWorkingHours, ScheduleBlock } from "./slots";

export interface BookingRange extends BookedRange {
  status?: string;
  activeSlot?: boolean | null;
}

/** Today's completed visits no longer block their scheduled duration, but legacy unique keys remain reserved. */
export function nearestBookingSlot(date: Date, schedules: ScheduleBlock[], booked: BookingRange[], duration: number, queueEmpty: boolean, nowMs = Date.now(), excludedStarts: ReadonlySet<string> = new Set()): string | null {
  const localNow = new Date(nowMs + ALGERIA_OFFSET_MINUTES * 60000);
  const today = localNow.toISOString().slice(0, 10);
  const day = date.toISOString().slice(0, 10);
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const completed = day === today ? booked.filter(row => row.status === "COMPLETED") : [];
  const occupied = day === today ? booked.filter(row => row.status !== "COMPLETED") : booked;
  const reservedStarts = new Set(completed.filter(row => row.activeSlot !== null).map(row => row.startTime));
  const grid = generateAvailableSlots(date, schedules, occupied, duration).sort();
  const from = day === today ? Math.ceil((localNow.getUTCHours() * 3600 + localNow.getUTCMinutes() * 60 + localNow.getUTCSeconds() + localNow.getUTCMilliseconds() / 1000) / 60) : 0;
  if (day < today) return null;
  if (day === today && (queueEmpty || completed.length > 0)) {
    for (let start = from; start + duration < 1440; start++) {
      const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
      if (!excludedStarts.has(format(start)) && !reservedStarts.has(format(start)) && isWithinWorkingHours(date, format(start), format(start + duration), schedules)
        && !occupied.some(range => start < minutes(range.endTime) && minutes(range.startTime) < start + duration)) return format(start);
    }
    return null;
  }
  return grid.find(time => minutes(time) >= from && !reservedStarts.has(time) && !excludedStarts.has(time)) ?? null;
}
