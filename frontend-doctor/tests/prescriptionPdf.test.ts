import test from "node:test";
import assert from "node:assert/strict";
import { isBlankPdfCanvas } from "../src/lib/prescriptionPdf.ts";

function canvas(pixels: number[], width = 1, height = 1): HTMLCanvasElement {
  return { width, height, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(pixels) }) }) } as unknown as HTMLCanvasElement;
}
test("an all-white or transparent capture is rejected before writing a PDF", () => {
  assert.equal(isBlankPdfCanvas(canvas([255, 255, 255, 255])), true);
  assert.equal(isBlankPdfCanvas(canvas([0, 0, 0, 0])), true);
  assert.equal(isBlankPdfCanvas(canvas([], 0, 0)), true);
});
test("Arabic/French ink and colored stationery count as rendered content", () => {
  assert.equal(isBlankPdfCanvas(canvas([20, 20, 20, 255])), false);
  assert.equal(isBlankPdfCanvas(canvas([24, 127, 119, 255])), false);
});
test("a missing drawing context fails instead of saving an unchecked file", () => {
  assert.throws(() => isBlankPdfCanvas({ width: 1, height: 1, getContext: () => null } as unknown as HTMLCanvasElement), /PDF_CANVAS_UNAVAILABLE/);
});
