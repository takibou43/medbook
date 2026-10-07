/** Algeria is UTC+1. Stop automatic keep-alive at 18:00, including Fridays. */
export function isKeepAwakeWindow(now: Date): boolean {
  const local = new Date(now.getTime() + 60 * 60_000);
  const startHour = local.getUTCDay() === 5 ? 17 : 5;
  return local.getUTCHours() >= startHour && local.getUTCHours() < 18;
}
