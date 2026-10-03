import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDzd, clinicSharePercentOf, formatPercent, termsExampleAr, parseTermsForm } from "../src/lib/doctorUi.ts";

test("المثال: 2000 دج بنسبة 80% = 1600 للطبيب و400 للعيادة", () => {
  assert.deepEqual(splitDzd(2000, 80), { doctorDzd: 1600, clinicDzd: 400 });
  assert.equal(clinicSharePercentOf(80), 20);
});
test("المجموع يساوي السعر دائمًا مع التقريب", () => {
  for (const p of [1, 7, 333, 1999, 12345]) for (const s of [0, 1, 33, 67, 85, 100]) {
    const r = splitDzd(p, s); assert.equal(r.doctorDzd + r.clinicDzd, p);
  }
});
test("نسبة غير محددة تظهر نصًا ولا مثال لها", () => {
  assert.equal(clinicSharePercentOf(null), null);
  assert.equal(formatPercent(null), "غير محددة");
  assert.equal(formatPercent(0), "0%");
  assert.equal(termsExampleAr(2000, null), null);
  assert.equal(termsExampleAr(null, 80), null);
  assert.match(termsExampleAr(2000, 80)!, /1.?600.*400/);
});
test("تحقق النموذج: قيم صالحة", () => {
  assert.deepEqual(parseTermsForm("2000", "80"), { ok: true, value: { appointmentPriceDzd: 2000, doctorSharePercent: 80 } });
  assert.equal(parseTermsForm("0", "0").ok, true);
  assert.equal(parseTermsForm(" 2000 ", " 100 ").ok, true);
});
test("تحقق النموذج: قيم مرفوضة", () => {
  for (const [p, s] of [["", "80"], ["2000", ""], ["-5", "80"], ["20.5", "80"], ["abc", "80"], ["2000", "101"], ["2000", "-1"], ["2000", "80.5"], ["2000", "8e1"], ["99999999999", "80"], ["10000001", "80"]])
    assert.equal(parseTermsForm(p, s).ok, false, `${p}/${s}`);
});
