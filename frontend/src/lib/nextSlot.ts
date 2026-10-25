import type { NextSlot } from "../types/index.ts";

export const nextSlotKey = (doctorId: string | undefined) => ["next-slot", doctorId] as const;
export const NEXT_SLOT_STALE_MS = 30_000;

export function isUpcomingSlot(slot: NextSlot | undefined, now = Date.now()): slot is NextSlot {
  return Boolean(slot && Date.parse(`${slot.date}T${slot.startTime}:00+01:00`) >= now);
}

export function nextSlotErrorKind(error: unknown): "noSlots" | "unavailable" | "failed" {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 409 ? "noSlots" : status === 404 ? "unavailable" : "failed";
}
