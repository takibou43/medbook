import assert from "node:assert/strict";
import test from "node:test";
import { INSTRUCTION_CHIPS, toggleInstructionChip } from "../src/lib/prescriptionMedication.ts";

test("الأزرار السريعة: إضافة، استبدال داخل نفس المجموعة، وإزالة بالضغط مرة ثانية", () => {
  let s = toggleInstructionChip("", "frequency", "3 مرات يوميًا", "ar");
  assert.equal(s, "3 مرات يوميًا");
  s = toggleInstructionChip(s, "timing", "بعد الأكل", "ar");
  assert.equal(s, "3 مرات يوميًا بعد الأكل");
  s = toggleInstructionChip(s, "duration", "لمدة 7 أيام", "ar");
  assert.equal(s, "3 مرات يوميًا بعد الأكل لمدة 7 أيام");
  // نفس المجموعة: يُستبدل ولا يتكرر
  s = toggleInstructionChip(s, "frequency", "مرتين يوميًا", "ar");
  assert.equal(s, "مرتين يوميًا بعد الأكل لمدة 7 أيام");
  // نفس الزر: يُزال
  s = toggleInstructionChip(s, "timing", "بعد الأكل", "ar");
  assert.equal(s, "مرتين يوميًا لمدة 7 أيام");
  // نص كتبه الطبيب يدويًا يُحفظ كما هو
  assert.equal(toggleInstructionChip("قرص واحد", "frequency", "مرتين يوميًا", "ar"), "قرص واحد مرتين يوميًا");
  assert.equal(toggleInstructionChip("", "duration", "pendant 7 jours", "fr"), "pendant 7 jours");
});

test("لا أزرار جرعات أو كميات: المجموعات خمس (شكل، طريقة أخذ، تكرار، وقت، مدة)", () => {
  assert.deepEqual(Object.keys(INSTRUCTION_CHIPS), ["form", "route", "frequency", "timing", "duration"]);
  for (const group of Object.values(INSTRUCTION_CHIPS)) for (const chip of [...group.ar, ...group.fr]) {
    assert.doesNotMatch(chip, /\d+\s*(mg|ml|g|ملغ|مل|غ)(?![\p{L}])/u, `الزر «${chip}» لا يجوز أن يحمل جرعة`);
  }
});

test("الشكل وطريقة الأخذ يُدرجان في بداية الجملة مهما كان ترتيب الضغط", () => {
  let s = toggleInstructionChip("", "frequency", "3 مرات يوميًا", "ar");
  s = toggleInstructionChip(s, "duration", "لمدة 7 أيام", "ar");
  s = toggleInstructionChip(s, "form", "قرص", "ar");
  assert.equal(s, "قرص 3 مرات يوميًا لمدة 7 أيام");
  s = toggleInstructionChip(s, "route", "عن طريق الفم", "ar");
  assert.equal(s, "قرص عن طريق الفم 3 مرات يوميًا لمدة 7 أيام");
  s = toggleInstructionChip(s, "timing", "بعد الأكل", "ar");
  assert.equal(s, "قرص عن طريق الفم 3 مرات يوميًا بعد الأكل لمدة 7 أيام");
  s = toggleInstructionChip(s, "form", "شراب", "ar");
  assert.equal(s, "شراب عن طريق الفم 3 مرات يوميًا بعد الأكل لمدة 7 أيام");
  assert.equal(toggleInstructionChip("pendant 7 jours", "form", "comprimé", "fr"), "comprimé pendant 7 jours");
});
