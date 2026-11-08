export const DAY_MS = 86_400_000;
export const MONTHLY_PRICE_DZD = 5_000;
export const MAX_PAYMENT_DZD = MONTHLY_PRICE_DZD * 120;
const ALGIERS_OFFSET_MS = 3_600_000;
export type BillingSchedule = { anchorAt: number; paidDzd: number };

export function readBillingSchedule(meta: unknown): BillingSchedule | null {
  const schedule = (meta as { billingSchedule?: BillingSchedule } | null)?.billingSchedule;
  return schedule && Number.isFinite(schedule.anchorAt) && Number.isSafeInteger(schedule.paidDzd) && schedule.paidDzd >= 0
    ? { anchorAt: schedule.anchorAt, paidDzd: schedule.paidDzd } : null;
}

// Retain the original day across short months: Jan 31 -> Feb 28 -> Mar 31.
export function addCalendarMonths(anchorAt: number, months: number): number {
  const local = new Date(anchorAt + ALGIERS_OFFSET_MS);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return local.getTime() - ALGIERS_OFFSET_MS;
}

function expiryForPaidAmount(anchorAt: number, paidDzd: number): number {
  const months = Math.floor(paidDzd / MONTHLY_PRICE_DZD);
  const remainder = paidDzd % MONTHLY_PRICE_DZD;
  const start = addCalendarMonths(anchorAt, months);
  const next = addCalendarMonths(anchorAt, months + 1);
  return start + (next - start) * remainder / MONTHLY_PRICE_DZD;
}

export function renewalQuote(amountDzd: number, currentEnd: number, now: number, previous?: BillingSchedule | null) {
  if (!Number.isSafeInteger(amountDzd) || amountDzd < 1 || amountDzd > MAX_PAYMENT_DZD) {
    throw new Error('أدخل مبلغًا صحيحًا من 1 إلى 600000 دج.');
  }
  const base = Math.max(Number.isFinite(currentEnd) ? currentEnd : 0, now);
  // Reuse the schedule only while the recorded expiry still matches it. This
  // preserves fractions across installments and resets after an expired gap/edit.
  const reusable = currentEnd >= now && previous &&
    Number.isFinite(previous.anchorAt) && Number.isSafeInteger(previous.paidDzd) && previous.paidDzd >= 0 &&
    expiryForPaidAmount(previous.anchorAt, previous.paidDzd) === currentEnd;
  const schedule: BillingSchedule = {
    anchorAt: reusable ? previous.anchorAt : base,
    paidDzd: (reusable ? previous.paidDzd : 0) + amountDzd,
  };
  const after = expiryForPaidAmount(schedule.anchorAt, schedule.paidDzd);
  return { after, durationMs: after - base, schedule };
}

export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let rest = ms;
  for (const [unit, label] of [[DAY_MS, 'يوم'], [3_600_000, 'ساعة'], [60_000, 'دقيقة']] as const) {
    const value = Math.floor(rest / unit);
    if (value) parts.push(`${value} ${label}`);
    rest %= unit;
  }
  if (rest) parts.push(`${Number((rest / 1000).toFixed(3))} ثانية`);
  return parts.join(' و') || '0 يوم';
}

export function formatExpiry(value: number | string): string {
  return new Date(value).toLocaleString('ar-DZ', {timeZone:'Africa/Algiers',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
}
