import test from "node:test";
import assert from "node:assert/strict";
import { authorizePrescriptionFolder, prescriptionPdfFilename, writePrescriptionPdf, type PrescriptionFolder } from "../src/lib/prescriptionFolder.ts";
import { pdfPageEnds } from "../src/lib/prescriptionPdf.ts";

test("PDF names preserve Arabic identity, remove path characters and distinguish repeated prints", () => {
  const name = prescriptionPdfFilename('../مريض/اسم:*?', '2026-10-15', 'one');
  assert.ok(name.includes('مريض'));
  assert.ok(!/[\\/:*?<>"|]/.test(name));
  assert.ok(name.endsWith('.pdf'));
  assert.notEqual(name, prescriptionPdfFilename('../مريض/اسم:*?', '2026-10-15', 'two'));
});

test("permission denial never writes a prescription file", async () => {
  let opened = false;
  const folder = { directory: { queryPermission: async () => "denied", requestPermission: async () => "denied", getFileHandle: async () => { opened = true; } } } as unknown as PrescriptionFolder;
  await assert.rejects(authorizePrescriptionFolder(folder), /PERMISSION_DENIED/);
  await assert.rejects(writePrescriptionPdf(folder, 'test.pdf', new Blob()), /PERMISSION_DENIED/);
  assert.equal(opened, false);
});

test("write errors abort the file stream and never report success", async () => {
  let aborted = false, closed = false;
  const folder = { directory: { queryPermission: async () => "granted", getFileHandle: async () => ({ createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, close: async () => { closed = true; }, abort: async () => { aborted = true; } }) }) } } as unknown as PrescriptionFolder;
  await assert.rejects(writePrescriptionPdf(folder, 'test.pdf', new Blob()), /disk full/);
  assert.equal(aborted, true); assert.equal(closed, false);
});

test("A5 pagination keeps medication blocks together without losing the continuation", () => {
  assert.deepEqual(pdfPageEnds(210, 210, []), [210]);
  assert.deepEqual(pdfPageEnds(450, 210, [{ top: 190, bottom: 230 }]), [190, 400, 450]);
  assert.deepEqual(pdfPageEnds(450, 210, [{ top: 0, bottom: 450 }]), [210, 420, 450]);
  // Adjacent rounded rectangles overlap by one pixel; that must not cascade back to the first item.
  const adjacent = Array.from({ length: 30 }, (_, i) => ({ top: i * 70, bottom: i * 70 + 71 }));
  assert.ok(pdfPageEnds(2100, 794, adjacent).length <= 3);
});
