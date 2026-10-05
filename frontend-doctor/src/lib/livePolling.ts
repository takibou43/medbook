export const LIVE_SAFETY_POLL_MS = 60_000;

export function livePollInterval(connected: boolean, fallback: number) {
  return connected ? LIVE_SAFETY_POLL_MS : fallback;
}

export const LIVE_QUERY_ROOTS = new Set([
  "queue", "appointments", "doctor-dashboard", "assistant-queues",
  "assistant-appointments", "assistant-daily-income",
]);
