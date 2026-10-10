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
