import test from 'node:test';
import assert from 'node:assert/strict';
import { prescriptionImageType, readTemplateImage } from '../src/lib/prescriptionTemplate.ts';

const jpeg = new Uint8Array([255, 216, 255, 224, 0, 1, 2, 3, 4, 5, 6, 7]);
test('mobile image imports inspect file bytes, not a missing or nonstandard MIME label', async () => {
  for (const type of ['', 'image/jpg', 'application/octet-stream']) {
    assert.equal(await prescriptionImageType(new File([jpeg], 'blank.jpg', { type })), 'image/jpeg');
  }
  await assert.rejects(prescriptionImageType(new File(['<svg/>'], 'fake.jpg', { type: 'image/jpeg' })), /صيغة الصورة/);
});

test('portrait stationery is fitted into A5 without stretching, cropping or inheriting old margins', async () => {
  const doc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const image = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const draws: number[][] = [];
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class { width = 1152; height = 1536; async decode() {} } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { return { width: 0, height: 0, getContext() { return { fillRect() {}, drawImage(_image: unknown, ...args: number[]) { draws.push(args); } }; }, toDataURL() { return 'data:image/jpeg;base64,fixture'; } }; } } });
  try {
    await readTemplateImage(new File([jpeg], 'reference.jpg', { type: '' }));
    const [x, y, w, h] = draws[0];
    assert.equal(x, 0);
    assert.ok(y > 0, 'white space is added above and below the reference image');
    assert.equal(w / h, 1152 / 1536, 'the original proportions remain intact');
    assert.equal(w, 1152);
    assert.ok(h < Math.round(w * 210 / 148));
  } finally {
    if (doc) Object.defineProperty(globalThis, 'document', doc); else Reflect.deleteProperty(globalThis, 'document');
    if (image) Object.defineProperty(globalThis, 'Image', image); else Reflect.deleteProperty(globalThis, 'Image');
  }
});
