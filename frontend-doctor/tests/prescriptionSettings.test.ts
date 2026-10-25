import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PRESCRIPTION_SETTINGS, normalizeSettings, sameSettings, settingsPayload } from "../src/lib/prescriptionSettings.ts";
import { emptyDraft, draftHasContent, newRequestItem, validateDraft, newMedication } from "../src/lib/prescription.ts";

const patient = { appointmentId: "a1", patientId: null, familyMemberId: null, bookedName: "Patient Test", relationship: null, accountHolderName: null, appointmentDate: "2026-10-11", startTime: "10:00" };

test("empty or partial server settings fall back to defaults without losing saved fields", () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_PRESCRIPTION_SETTINGS, professional: { ar: {}, fr: {} } });
  const n = normalizeSettings({ language: "fr", professional: { fr: { clinicName: "Cabinet" } }, show: { phone: false } });
  assert.equal(n.language, "fr");
  assert.equal(n.professional.fr?.clinicName, "Cabinet");
  assert.deepEqual(n.show, { clinicName: true, address: true, phone: false, specialty: true });
  assert.equal(normalizeSettings({ language: "en" }).language, "ar");
});

test("payload trims text, drops empty fields and detects unchanged settings", () => {
  const s = normalizeSettings({ language: "ar", professional: { ar: { doctorName: "  Dr X  ", address: "   " } } });
  assert.deepEqual(settingsPayload(s).professional, { ar: { doctorName: "Dr X" }, fr: {} });
  assert.equal(sameSettings(s, normalizeSettings({ language: "ar", professional: { ar: { doctorName: "Dr X" } } })), true);
  assert.equal(sameSettings(s, { ...s, language: "fr" }), false);
});

test("labs and imaging: filtered, trimmed, named; request-only prescriptions are valid", () => {
  const d = emptyDraft("u1", patient);
  assert.equal(validateDraft(d).ok, false);
  const lab = { ...newRequestItem(), name: "  NFS  ", note: " à jeun " };
  const ok = validateDraft({ ...d, labs: [lab, newRequestItem()] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.labs.map(l => [l.name, l.note]), [["NFS", "à jeun"]]);
  assert.equal(ok.printable.length, 0);
  const noName = { ...newRequestItem(), note: "sans nom" };
  const bad = validateDraft({ ...d, imaging: [noName] });
  assert.equal(bad.ok, false);
  assert.ok(bad.requestErrors[noName.id]);
});

test("request items count as draft content so they are never silently lost", () => {
  const d = emptyDraft("u1", patient);
  assert.equal(draftHasContent(d), false);
  assert.equal(draftHasContent({ ...d, imaging: [{ ...newRequestItem(), name: "Radio thorax" }] }), true);
  const withMed = validateDraft({ ...d, medications: [{ ...newMedication(), name: "Médicament test", directionsMode: "freeText", instructions: "selon indication" }], labs: [{ ...newRequestItem(), name: "CRP" }] });
  assert.equal(withMed.ok, true);
});

test('header language is independent of content language and preserved through normalization', () => {
 const saved = normalizeSettings({language:'fr',headerLanguage:'both',professional:{ar:{doctorName:'اسم'},fr:{doctorName:'Name'}}});
 assert.equal(settingsPayload(saved).headerLanguage,'both');
 assert.equal(saved.language,'fr');
 assert.equal(sameSettings(saved,{...saved,headerLanguage:'fr'}),false);
 assert.equal(normalizeSettings({headerLanguage:'invalid'}).headerLanguage,undefined);
});

test("رقم التسجيل N° d'ordre: يُقرأ ويُرسل مقصوصًا، والفارغ لا يُرسل، وغير الصالح يُرفض", async () => {
  const { normalizeSettings, settingsPayload, validOrderNumber } = await import("../src/lib/prescriptionSettings.ts");
  assert.equal(normalizeSettings({ language: "fr", orderNumber: " 114/28 " }).orderNumber, "114/28");
  assert.equal(normalizeSettings({ language: "fr", orderNumber: 5 }).orderNumber, undefined);
  const base = normalizeSettings({});
  assert.equal(settingsPayload({ ...base, orderNumber: " 114 " }).orderNumber, "114");
  assert.equal("orderNumber" in settingsPayload({ ...base, orderNumber: "  " }), false);
  assert.ok(validOrderNumber("114/28") && validOrderNumber(""));
  assert.ok(!validOrderNumber("<b>") && !validOrderNumber("١١٤") && !validOrderNumber("x".repeat(21)));
});
