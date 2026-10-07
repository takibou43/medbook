/** Automatic keep-alive runs daily from 07:30 inclusive to 18:00 exclusive in Algeria. */
export function isKeepAwakeWindow(now: Date): boolean {
  const local = new Date(now.getTime() + 60 * 60_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutes >= 7 * 60 + 30 && minutes < 18 * 60;
}
