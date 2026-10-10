import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrescriptionDesign, type PrescriptionDesign } from '../src/lib/prescriptionDesign.ts';

const base: PrescriptionDesign = { version: 1, language: 'ar', doctorName: 'طبيب تجريبي', specialty: 'تخصص تجريبي', clinicName: 'عيادة تجريبية', address: 'عنوان تجريبي', phone: '0000000000', footer: 'تذييل تجريبي', color: '#187f77', layout: 'split', logo: null, logoPosition: 'left', headerSize: 18 };

test('blank designs reserve bounded writing space, preserve editable metadata and exclude patient data', async () => {
  const text: string[] = [];
  const context = { scale() {}, fillRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, measureText(value: string) { return { width: value.length * 1.6 }; }, fillText(value: string) { text.push(value); } };
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { fonts: { ready: Promise.resolve() }, createElement() { return { getContext() { return context; }, toDataURL() { return 'data:image/jpeg;base64,fixture'; } }; } } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class { width = 200; height = 100; async decode() {} } });
  try {
    for (const language of ['ar', 'fr'] as const) {
      const input = { ...base, language, logo: 'data:image/png;base64,fixture' };
      const result = await renderPrescriptionDesign(input);
      assert.ok(result.top >= 10 && result.top <= 75);
      assert.ok(result.bottom >= 10 && result.bottom <= 60);
      assert.deepEqual(result.design, input);
      assert.notEqual(result.design, input);
      assert.deepEqual(Object.keys(result).sort(), ['bottom', 'design', 'image', 'side', 'top']);
    }
    assert.ok(text.includes(base.doctorName));
    assert.ok(text.includes(base.footer));
    assert.ok(text.includes('توقيع الطبيب / الختم'));
    await assert.rejects(renderPrescriptionDesign({ ...base, doctorName: '' }), /اسم الطبيب/);
    await assert.rejects(renderPrescriptionDesign({ ...base, doctorName: 'a'.repeat(300) }), /كلمة طويلة/);
    await assert.rejects(renderPrescriptionDesign({ ...base, footer: 'a'.repeat(300) }), /كلمة طويلة/);
    await assert.rejects(renderPrescriptionDesign({ ...base, address: 'long address '.repeat(100) }), /الترويسة كبيرة/);
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldImage) Object.defineProperty(globalThis, 'Image', oldImage); else Reflect.deleteProperty(globalThis, 'Image');
  }
});
