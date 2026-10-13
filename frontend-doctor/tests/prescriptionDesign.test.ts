import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeSimpleHeader, readSimpleHeader, renderPrescriptionDesign, initialDesignElements, overlapsWritingArea, type PrescriptionDesign } from '../src/lib/prescriptionDesign.ts';

const base: PrescriptionDesign = { version: 1, language: 'ar', doctorName: 'طبيب تجريبي', specialty: 'تخصص تجريبي', clinicName: 'عيادة تجريبية', address: 'عنوان تجريبي', phone: '0000000000', footer: 'تذييل تجريبي', color: '#187f77', layout: 'split', logo: null, logoPosition: 'left', headerSize: 18 };

test('simple header keeps explicit names, centers the logo and reserves writing space without dropping custom text', () => {
  const fields = { ...readSimpleHeader(base), nameAr: 'اسم تجريبي', nameFr: 'Test Doctor', color: '#112233' };
  const extra = { ...initialDesignElements(base)[0], id: 'custom-note', y: 193, height: 9, text: 'Custom note' };
  const result = arrangeSimpleHeader({ ...base, logo: 'fixture', elements: [extra] }, fields);
  const elements = result.elements!;
  assert.equal(elements.find(e => e.id === 'name-ar')?.align, 'right');
  assert.equal(elements.find(e => e.id === 'name-fr')?.align, 'left');
  const logo = elements.find(e => e.kind === 'logo')!;
  assert.equal(logo.x + logo.width / 2, 74);
  assert.ok(elements.every(e => !overlapsWritingArea(e, result.writingArea!)));
  assert.deepEqual(elements.find(e => e.id === extra.id), extra);
  assert.equal(readSimpleHeader(result).nameFr, 'Test Doctor');
  assert.equal(readSimpleHeader({ ...base, doctorName: 'Test Doctor' }).nameAr, '');
  const cleared = arrangeSimpleHeader(result, { ...fields, nameAr: '' });
  assert.equal(readSimpleHeader(cleared, { ar: 'Saved old name' }).nameAr, '');
  assert.deepEqual(arrangeSimpleHeader(result, fields), result);
});

test('blank designs reserve bounded writing space, preserve editable metadata and exclude patient data', async () => {
  const text: string[] = [];
  const images: number[][] = [];
  const context = { save() {}, restore() {}, rect() {}, clip() {}, scale() {}, fillRect() {}, drawImage(_image: unknown, ...bounds: number[]) { images.push(bounds); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, measureText(value: string) { return { width: value.length * 1.6 }; }, fillText(value: string) { text.push(value); } };
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
    const elements = initialDesignElements(base);
    const custom = { ...designFixture(), elements: [...elements, { ...elements[0], id: 'logo-free', kind: 'logo' as const, x: 95, y: 185, width: 40, height: 20 }], writingArea: { top: 60, bottom: 30, side: 12 } };
    function designFixture() { return { ...base, logo: 'fixture' }; }
    const free = await renderPrescriptionDesign(custom);
    assert.deepEqual(images.at(-1), [95, 185, 40, 20]);
    assert.deepEqual(free.design, custom);
    assert.equal(free.top, 60);
    assert.equal(free.bottom, 30);
    assert.equal(overlapsWritingArea(custom.elements.at(-1)!, custom.writingArea), false);
    assert.equal(overlapsWritingArea({ ...elements[0], y: 80 }, custom.writingArea), true);
    for (const logoPosition of ['left', 'center', 'right'] as const) {
      const result = await renderPrescriptionDesign({ ...base, logo: 'fixture', logoPosition, logoSize: 30, logoTop: 15 });
      assert.deepEqual(images.at(-1), [logoPosition === 'left' ? 12 : logoPosition === 'center' ? 59 : 106, 15, 30, 15]);
      assert.ok(result.top > 45, 'writing area must remain below the logo');
      assert.equal(result.design?.logoSize, 30);
      assert.equal(result.design?.logoTop, 15);
    }
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
