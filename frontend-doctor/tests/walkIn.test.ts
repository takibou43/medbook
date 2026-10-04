import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWalkInBody, EMPTY_WALK_IN, keepKeyAfterError, newIdempotencyKey, normalizePhone, resolveWalkInDoctor, validateWalkIn } from "../src/lib/walkIn.ts";

const ok = { ...EMPTY_WALK_IN, firstName: "سارة", lastName: "بن علي", phone: "0551 23-45 67" };

test("normalizePhone يحذف المسافات والشرطات", () => {
  assert.equal(normalizePhone("0551 23-45 67"), "0551234567");
});

test("validateWalkIn: صالح بلا وقت، وأخطاء واضحة للحقول الناقصة", () => {
  assert.deepEqual(validateWalkIn(ok), {});
  const e = validateWalkIn({ ...EMPTY_WALK_IN, firstName: "a", phone: "0312345678", startTime: "9:00" });
  assert.ok(e.firstName && e.lastName && e.phone && e.startTime);
});

test("buildWalkInBody: لا يرسل وقتًا ولا ملاحظات فارغة، ويطبّع الهاتف", () => {
  const b = buildWalkInBody({ ...ok, notes: "   " }, "k");
  assert.deepEqual(b, { firstName: "سارة", lastName: "بن علي", phone: "0551234567", idempotencyKey: "k" });
  const b2 = buildWalkInBody({ ...ok, notes: " حرارة ", startTime: "15:30" }, "k2");
  assert.equal(b2.notes, "حرارة");
  assert.equal(b2.startTime, "15:30");
});

test("newIdempotencyKey: UUID v4 ومختلف في كل مرة", () => {
  const a = newIdempotencyKey();
  const b = newIdempotencyKey();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test("keepKeyAfterError: نحتفظ بالمفتاح عند النتيجة المجهولة فقط", () => {
  assert.equal(keepKeyAfterError(undefined), true);
  assert.equal(keepKeyAfterError(503), true);
  assert.equal(keepKeyAfterError(409), false);
  assert.equal(keepKeyAfterError(400), false);
});

test("resolveWalkInDoctor: طبيب واحد ⇒ تلقائي، حتى بلا اختيار", () => {
  assert.equal(resolveWalkInDoctor(["a"], ""), "a");
  assert.equal(resolveWalkInDoctor(["a"], "zzz"), "a");
});

test("resolveWalkInDoctor: عدة أطباء ⇒ يبقى الاختيار إن كان ضمن القائمة، وإلا يُطلب الاختيار", () => {
  assert.equal(resolveWalkInDoctor(["a", "b"], "b"), "b");
  assert.equal(resolveWalkInDoctor(["a", "b"], ""), "");
  assert.equal(resolveWalkInDoctor(["a", "b"], "c"), "");
  assert.equal(resolveWalkInDoctor([], "a"), "");
});
