// Live changes invalidate these queries immediately; this only recovers missed events.
export const LIVE_SAFETY_POLL_MS = 5 * 60_000;

export function livePollInterval(connected: boolean, fallback: number) {
  return connected ? LIVE_SAFETY_POLL_MS : fallback;
}

export const LIVE_QUERY_ROOTS = new Set([
  "queue", "appointments", "doctor-dashboard", "assistant-queues",
  "assistant-appointments", "assistant-daily-income", "shift",
]);

// حالة المداومة: بدؤها وإنهاؤها يصلان فورًا عبر الإشارة الحية، وانتهاؤها بمرور الوقت يُحسب محليًا من
// endsAt. الاستطلاع هنا احتياط فقط، أقصر من الاحتياط العام لأن المداومة تنتهي تلقائيًا بعد دقيقة ونصف.
export const SHIFT_LIVE_POLL_MS = 60_000;
export function shiftPollInterval(connected: boolean, fallback: number) {
  return connected ? SHIFT_LIVE_POLL_MS : fallback;
}
