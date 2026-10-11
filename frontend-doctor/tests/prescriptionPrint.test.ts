import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prescriptionLabels, prescriptionDate, prescriptionCatalogName, professionalText } from '../src/lib/prescriptionPrint.ts';
import { emptyDraft, draftHasContent, newMedication } from '../src/lib/prescription.ts';

test('French print labels and calendar date are explicit; invalid days are rejected', () => {
  assert.match(prescriptionDate('2026-10-10', 'fr'), /10 octobre 2026/);
  assert.match(prescriptionDate('2026-10-10', 'ar'), /أكتوبر/);
  assert.equal(prescriptionDate('2026-02-30', 'fr'), '');
  assert.equal(prescriptionDate('invalid', 'ar'), '');
  const fr = prescriptionLabels('fr');
  assert.deepEqual([fr.dose, fr.frequency, fr.duration, fr.instructions, fr.signature, fr.stamp], ['Dose', 'Fréquence', 'Durée', 'Instructions :', 'Signature du médecin', 'Cachet']);
});

test('missing French professional/catalog text preserves the approved original; no translation guesses', () => {
  const specialty = { nameAr: 'طب الأسنان', nameFr: 'Chirurgie dentaire' };
  assert.equal(prescriptionCatalogName(specialty, 'fr'), 'Chirurgie dentaire');
  assert.equal(prescriptionCatalogName(specialty, 'ar'), 'طب الأسنان');
  assert.equal(prescriptionCatalogName({nameAr: 'مدينة أصلية'}, 'fr'), 'مدينة أصلية');
  assert.equal(professionalText('  ', 'العيادة الأصلية'), 'العيادة الأصلية');
  assert.equal(professionalText(' Cabinet choisi ', 'العيادة الأصلية'), 'Cabinet choisi');
});

test('language and per-language professional edits preserve beneficiary and all entered medication content', () => {
  const patient = { appointmentId: 'visit', patientId: 'account', familyMemberId: 'family', bookedName: 'مستفيد', relationship: null, accountHolderName: 'صاحب الحساب', appointmentDate: '2026-10-10', startTime: '15:26' };
  const draft = emptyDraft('doctor', patient, 'current');
  const customized = {...draft, professional: {fr: {clinicName: 'Cabinet FR'}, ar: {clinicName: 'عيادة عربية'}}};
  assert.equal(draftHasContent(customized), true);
  const medications = [{...newMedication(), name: 'Médicament A', dose: 'نص الطبيب', frequency: 'عند الحاجة', duration: 'حسب الحالة'}];
  const changed = {...customized, medications, printLanguage: 'fr' as const};
  assert.equal(changed.patient, patient);
  assert.equal(changed.medications, medications);
  assert.equal(changed.patientName, patient.bookedName);
  assert.equal(changed.professional.ar.clinicName, 'عيادة عربية');
});

import { doctorHeaderName, stripDoctorPrefix } from "../src/lib/prescriptionPrint.ts";
import test2 from "node:test";
import assert2 from "node:assert/strict";

test2("اسم الطبيب: حقل لكل جهة بلا ترجمة ولا اختلاق", () => {
  assert2.equal(doctorHeaderName("أحمد بن علي", "Alger Mila", "ar"), "أحمد بن علي");
  assert2.equal(doctorHeaderName("Ahmed Ben Ali", "Alger Mila", "fr"), "Ahmed Ben Ali");
  // الجهة العربية فارغة واسم الحساب لاتيني: لا يُعرض الاسم الفرنسي ولا يُختلق اسم عربي
  assert2.equal(doctorHeaderName("", "Alger Mila", "ar"), "");
  assert2.equal(doctorHeaderName(undefined, "Alger Mila", "fr"), "Alger Mila");
  // اسم حساب عربي قديم يبقى في الجهة العربية فقط
  assert2.equal(doctorHeaderName("", "أحمد علي", "ar"), "أحمد علي");
  assert2.equal(doctorHeaderName("", "أحمد علي", "fr"), "");
});

test2("اسم الطبيب: عدم تكرار البادئة ولا قصّ أسماء تبدأ بحرف الدال", () => {
  assert2.equal(stripDoctorPrefix("د. أحمد", "ar"), "أحمد");
  assert2.equal(stripDoctorPrefix("د/ أحمد", "ar"), "أحمد");
  assert2.equal(stripDoctorPrefix("الدكتور أحمد", "ar"), "أحمد");
  assert2.equal(stripDoctorPrefix("دليلة بوعلام", "ar"), "دليلة بوعلام");
  assert2.equal(stripDoctorPrefix("Dr. Ahmed", "fr"), "Ahmed");
  assert2.equal(stripDoctorPrefix("Docteur Ahmed", "fr"), "Ahmed");
  assert2.equal(stripDoctorPrefix("Drissi Karim", "fr"), "Drissi Karim");
});

import { clinicHeaderName } from "../src/lib/prescriptionPrint.ts";
test2("اسم العيادة: حقل لكل جهة بلا ترجمة", () => {
  assert2.equal(clinicHeaderName("Clinique El Amel", "عيادة الأمل", "fr"), "Clinique El Amel");
  assert2.equal(clinicHeaderName("", "عيادة الأمل", "fr"), "");
  assert2.equal(clinicHeaderName("", "عيادة الأمل", "ar"), "عيادة الأمل");
  assert2.equal(clinicHeaderName("", "Clinique El Amel", "ar"), "");
  assert2.equal(clinicHeaderName(undefined, undefined, "ar"), "");
});

test2("العنوان: يعاد استعمال منطق الجهة نفسه", () => {
  assert2.equal(clinicHeaderName("12 Rue Didouche, Mila", "حي النصر", "fr"), "12 Rue Didouche, Mila");
  assert2.equal(clinicHeaderName("", "حي النصر", "fr"), "");
  assert2.equal(clinicHeaderName("حي النصر، ميلة", "Cité 5 Juillet", "ar"), "حي النصر، ميلة");
});
