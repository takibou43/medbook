// A text input accepts Arabic/Persian digits on mobile keyboards, unlike number inputs.
export function normalizeSubscriptionDigits(value: string): string {
  return value.replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0));
}

export function parseSubscriptionAmount(value: string, maxPaymentDzd: number): number | null {
  const normalized = normalizeSubscriptionDigits(value).trim();
  // Grouped thousands are accepted on paste, but decimal and malformed values are not.
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:[\s,٬][0-9]{3})+)$/.test(normalized)) return null;
  const amount = Number(normalized.replace(/[\s,٬]/g, ''));
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= maxPaymentDzd ? amount : null;
}
