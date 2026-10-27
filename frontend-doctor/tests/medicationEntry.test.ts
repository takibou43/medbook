import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, validateDraft, filled, newMedication, type PrescriptionPatient } from "../src/lib/prescription.ts";
import { readMedicationNames, rememberMedicationName } from "../src/lib/medicationNames.ts";

test("new medication entry starts with explicit dose fields and no assumed values", () => {
  const draft = emptyDraft("doctor", { bookedName: "TEST PATIENT" } as PrescriptionPatient);
  const row = draft.medications[0];
  assert.equal(row.directionsMode, "structured");
  assert.equal(row.dose, "");
  assert.equal(row.frequency, "");
  assert.equal(row.duration, "");
  assert.equal(validateDraft(draft).ok, false);
  row.name = "TEST MEDICINE";
  row.doseQty = "1";
  row.doseUnit = "tablet";
  row.freqKey = "twice";
  row.durQty = "5";
  row.durUnit = "day";
  assert.equal(filled(row), true);
  const result = validateDraft(draft);
  assert.equal(result.ok, true);
  assert.equal(result.printable[0].doseQty, "1");
  assert.equal(result.printable[0].freqKey, "twice");
  assert.equal(result.printable[0].durQty, "5");
  assert.equal(validateDraft({ ...draft, medications: [...draft.medications, newMedication("freeText")] }).printable.length, 1);
});

test("name suggestions contain names only, deduplicate and isolate doctors, and tolerate unavailable storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    assert.deepEqual(rememberMedicationName("d1", "  TEST   MEDICINE  "), ["TEST MEDICINE"]);
    assert.deepEqual(rememberMedicationName("d1", "test medicine"), ["test medicine"]);
    assert.deepEqual(readMedicationNames("d2"), []);
    assert.deepEqual(rememberMedicationName("", "OTHER"), []);
    assert.deepEqual(JSON.parse([...values.values()][0]), ["test medicine"]);
    values.set("medbook-medication-names-v1:d1", "malformed");
    assert.deepEqual(readMedicationNames("d1"), []);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw Error("disabled"); } });
    assert.deepEqual(readMedicationNames("d1"), []);
    assert.deepEqual(rememberMedicationName("d1", "TEST"), ["TEST"]);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
