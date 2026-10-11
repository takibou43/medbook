import { AppointmentStatus } from "@prisma/client";

/**
 * أولوية موعد المتابعة الطبية التي يحددها الطبيب من «خطط العلاج»: عند تساوي الوقت الظاهر (startTime) فقط
 * يسبق موعد المتابعة الحجوزات العادية، ثم تُرتَّب المتابعات بينها بترتيبها الداخلي slotSeq (ترتيب الإنشاء).
 * الحقلان اختياريان: الصفوف القديمة (false/0) لا يتغير ترتيبها إطلاقًا. لا يُستعمل أي ثوانٍ في الترتيب.
 */
export interface FollowUpRank { doctorFollowUp?: boolean | null; slotSeq?: number | null }
export function followUpRankCompare(a: FollowUpRank, b: FollowUpRank): number {
  return Number(!!b.doctorFollowUp) - Number(!!a.doctorFollowUp) || (a.slotSeq ?? 0) - (b.slotSeq ?? 0);
}

/** Admission priority is the original appointment time, never a lateness penalty. */
export function firstPresent<T extends { id: string; startTime: string; status: string; arrivedAt: Date | string | null; urgencyStatus?: string } & FollowUpRank>(rows: T[]): T | null {
  return rows.filter(a => a.arrivedAt && (a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.LATE))
    .sort((a, b) => Number(b.urgencyStatus === "APPROVED") - Number(a.urgencyStatus === "APPROVED") || a.startTime.localeCompare(b.startTime) || followUpRankCompare(a, b) || a.id.localeCompare(b.id))[0] ?? null;
}

/** Present patients first; absent patients retain their original appointment order. */
export function presentQueueOrder<T extends { id: string; startTime: string; arrivedAt?: Date | string | null; urgencyStatus?: string } & FollowUpRank>(rows: T[]): T[] {
  return [...rows].sort((a,b) => Number(!!b.arrivedAt) - Number(!!a.arrivedAt) || Number(b.urgencyStatus === "APPROVED") - Number(a.urgencyStatus === "APPROVED") || a.startTime.localeCompare(b.startTime) || followUpRankCompare(a, b) || a.id.localeCompare(b.id));
}
