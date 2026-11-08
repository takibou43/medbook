import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubscriptionDigits, parseSubscriptionAmount } from '../src/lib/subscriptionAmount.ts';
const parse = (value: string) => parseSubscriptionAmount(value, 600_000);

test('Arabic and Persian mobile digits produce the amount sent to the server', () => {
  for (const value of ['8000', '٨٠٠٠', '۸۰۰۰', '٨۰٠۰']) {
    assert.equal(parse(value), 8000);
  }
  assert.equal(normalizeSubscriptionDigits('٦٠٠٠٠'), '60000');
});

test('pasted grouping is accepted without changing the monetary amount', () => {
  for (const value of ['٥٬٠٠٠', '5,000', '5 000', '60 000', '٦٠٬٠٠٠']) {
    assert.equal(parse(value), value.includes('60') || value.includes('٦٠') ? 60000 : 5000);
  }
});

test('incomplete, decimal, ambiguous and out-of-range amounts cannot be submitted', () => {
  for (const value of ['', ' ', '٠', '5.000', '٥٫٥', '5,00', '12 34', '-5000', '600001', 'NaN']) {
    assert.equal(parse(value), null, value);
  }
});
