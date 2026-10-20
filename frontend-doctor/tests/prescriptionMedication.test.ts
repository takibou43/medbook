import test from "node:test";
import assert from "node:assert/strict";
import { medicationParts, medicationFactItems, medicationSummary, structuredErrors, medicationComplete, editableValues, doseText, durationText } from "../src/lib/prescriptionMedication.ts";
import { newMedication, restoreMedication, validateDraft, emptyDraft, draftHasContent, type PrescriptionMedication } from "../src/lib/prescription.ts";

const med = (p: Partial<PrescriptionMedication> = {}): PrescriptionMedication => ({ ...newMedication(), id: p.id ?? "m1", ...p });

test("structured values print in order with units in the chosen language, with French plurals and Arabic number forms", () => {
  const m = med({ name: "Amoxicilline", strength: "500 mg", form: "gélule", doseQty: "2", doseUnit: "capsule", freqKey: "three", timingKey: "afterMeal", durQty: "7", durUnit: "day", instructions: "Avec de l’eau" });
  assert.deepEqual(medicationParts(m, "fr"), { name: "Amoxicilline", detail: "500 mg gélule", facts: ["2 gélules", "3 fois par jour", "après les repas", "7 jours"], instructions: "Avec de l’eau" });
  assert.deepEqual(medicationParts(m, "ar").facts, ["2 كبسولة", "3 مرات يوميًا", "بعد الطعام", "7 أيام"]);
  assert.equal(doseText(med({ doseQty: "1", doseUnit: "tablet" }), "fr"), "1 comprimé");
  assert.equal(doseText(med({ doseQty: "1/2", doseUnit: "tablet" }), "fr"), "1/2 comprimé");
  assert.equal(durationText(med({ durQty: "2", durUnit: "week" }), "ar"), "2 أسبوعان");
  assert.equal(durationText(med({ durQty: "12", durUnit: "day" }), "ar"), "12 يومًا");
  assert.equal(durationText(med({ durQty: "3", durUnit: "month" }), "fr"), "3 mois");
});

test("nothing is assumed: empty medication has no parts and never prints undefined", () => {
  const p = medicationParts(med(), "ar");
  assert.deepEqual(p, { name: "", detail: "", facts: [], instructions: "" });
  assert.ok(!medicationSummary(med({ name: "X" }), "fr").includes("undefined"));
  assert.equal(medicationSummary(med({ name: "X", doseQty: "5" }), "fr"), "X — 5");
});

test("legacy free-text dose, frequency and duration are shown exactly as written and are not converted", () => {
  const m = med({ name: "Doliprane", dose: "1 sachet", frequency: "si fièvre", duration: "3 jours", instructions: "Après repas" });
  assert.deepEqual(medicationParts(m, "ar").facts, ["1 sachet", "si fièvre", "3 jours"]);
  const e = editableValues(m);
  assert.equal(e.doseUnit, "custom"); assert.equal(e.doseCustom, "1 sachet");
  assert.equal(e.freqKey, "custom"); assert.equal(e.durUnit, "custom");
  assert.equal(m.doseQty, undefined); // لا كتابة على الحقول الجديدة دون تعديل
  assert.deepEqual(structuredErrors(m), {});
  assert.equal(medicationComplete(m), true);
});

test("custom choices print the doctor's own wording", () => {
  const m = med({ name: "Insuline", doseQty: "10", doseUnit: "custom", doseCustom: "unités", freqKey: "custom", freqCustom: "toutes les 8 heures", timingKey: "custom", timingCustom: "avant le coucher", durUnit: "custom", durCustom: "jusqu’à la fin de la boîte" });
  assert.deepEqual(medicationParts(m, "fr").facts, ["10 unités", "toutes les 8 heures", "avant le coucher", "jusqu’à la fin de la boîte"]);
});

test("free-text mode prints only name, strength/form and instructions while keeping structured values untouched", () => {
  const m = med({ name: "Ventoline", directionsMode: "freeText", instructions: "Deux bouffées si gêne respiratoire", doseQty: "2", doseUnit: "puff" });
  assert.deepEqual(medicationParts(m, "fr"), { name: "Ventoline", detail: "", facts: [], instructions: "Deux bouffées si gêne respiratoire" });
  assert.equal(m.doseQty, "2");
  assert.equal(medicationComplete(m), true);
  assert.equal(medicationComplete({ ...m, instructions: "" }), false);
});

test("print facts retain their source field even when entered values are bare numbers", () => {
  const m = med({ name: "Example", dose: "2", frequency: "3", duration: "5" });
  assert.deepEqual(medicationFactItems(m, "fr"), [
    { key: "dose", value: "2" },
    { key: "frequency", value: "3" },
    { key: "duration", value: "5" },
  ]);
  assert.deepEqual(medicationFactItems({ ...m, directionsMode: "freeText" }, "fr"), []);
});

test("validation explains each missing structured field without medical rules", () => {
  assert.deepEqual(Object.keys(structuredErrors(med({ name: "A" }))).sort(), ["dose", "duration", "frequency"]);
  assert.match(structuredErrors(med({ doseQty: "1" })).dose!, /وحدة/);
  assert.match(structuredErrors(med({ durQty: "5" })).duration!, /وحدة/);
  const ok = med({ name: "A", doseQty: "1", doseUnit: "tablet", freqKey: "once", durQty: "5", durUnit: "day" });
  assert.deepEqual(structuredErrors(ok), {});
});

test("validateDraft uses the structured fields and still accepts legacy drafts", () => {
  const patient = { appointmentId: "a1", patientId: "p1", familyMemberId: "f1", bookedName: "Test", relationship: null, accountHolderName: null, appointmentDate: "2026-10-11", startTime: "09:00" };
  const d = emptyDraft("u1", patient);
  d.medications = [med({ name: "Legacy", dose: "1", frequency: "2/j", duration: "5 j" }), med({ id: "m2", name: "New", doseQty: "1", doseUnit: "tablet" })];
  const v = validateDraft(d);
  assert.equal(v.ok, false);
  assert.deepEqual(Object.keys(v.medicationErrors), ["m2"]);
  assert.deepEqual(Object.keys(v.medicationErrors.m2).sort(), ["duration", "frequency"]);
  assert.equal(v.printable.length, 2);
  assert.equal(d.patient.appointmentId, "a1"); assert.equal(d.patient.patientId, "p1"); assert.equal(d.patient.familyMemberId, "f1");
  assert.equal(draftHasContent({ ...d, medications: [med({ strength: "500 mg" })], patientName: "Test" }), true);
});

test("restoreMedication puts a deleted medication back with every value and its position", () => {
  const a = med({ id: "a", name: "A", doseQty: "1", doseUnit: "tablet" }), b = med({ id: "b", name: "B", instructions: "x" }), c = med({ id: "c", name: "C" });
  const after = [a, c];
  const restored = restoreMedication(after, b, 1);
  assert.deepEqual(restored.map((m) => m.id), ["a", "b", "c"]);
  assert.deepEqual(restored[1], b);
  assert.deepEqual(restoreMedication([newMedication()], a, 0), [a]); // حذف الدواء الوحيد ثم التراجع
  assert.equal(restoreMedication(restored, b, 0), restored); // لا تكرار
  assert.deepEqual(restoreMedication([a], c, 9).map((m) => m.id), ["a", "c"]);
});

import { glueNumberUnit } from "../src/lib/prescriptionMedication.ts";

test("glueNumberUnit keeps each number with its unit, changing only the kind of space", () => {
  assert.equal(glueNumberUnit("10 jours"), "10 jours");
  assert.equal(glueNumberUnit("2 comprimés — 20 jours"), "2 comprimés — 20 jours");
  assert.equal(glueNumberUnit("10 أيام"), "10 أيام");
  assert.equal(glueNumberUnit("١٠ أيام"), "١٠ أيام");
  assert.equal(glueNumberUnit("1 صباحًا و1 مساءً"), "1 صباحًا و1 مساءً");
  // no characters added or removed: only the space kind differs
  const src = "pendant 10 jours, 2 comprimés le matin";
  assert.equal(glueNumberUnit(src).replace(/ /g, " "), src);
  // plain words stay breakable so long instructions can wrap
  assert.equal(glueNumberUnit("avec un grand verre d'eau"), "avec un grand verre d'eau");
});

test("medicationParts feeds line 1 (name+strength) and line 2 (dose, frequency, timing, duration) separately", () => {
  const m = { id: "x", name: "Amoxicilline", dose: "", frequency: "", duration: "", instructions: "avec de l'eau", directionsMode: "structured" as const, strength: "500 mg", doseQty: "2", doseUnit: "tablet", freqKey: "three", timingKey: "afterMeal", durQty: "10", durUnit: "day" };
  const p = medicationParts(m, "fr");
  assert.equal(p.name, "Amoxicilline");
  assert.equal(p.detail, "500 mg");
  assert.deepEqual(p.facts, ["2 comprimés", "3 fois par jour", "après les repas", "10 jours"]);
  assert.equal(p.instructions, "avec de l'eau");
});
