type PollableStatus = { status: string; isToday: boolean };

/** Keep live queues responsive; finished appointments need no periodic request. */
export function statusPollInterval(data: PollableStatus | undefined, liveInterval: number): number | false {
  if (!data) return liveInterval;
  if (["COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULE_REQUIRED"].includes(data.status)) return false;
  return data.isToday ? liveInterval : 60_000;
}
