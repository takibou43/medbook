import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tsx = readFileSync(new URL("../src/components/prescription/PrescriptionPrint.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

test("standard sheet prints with zero page margin so browsers have no margin area for URL/title/date", () => {
  assert.match(tsx, /!template && <style>\{`@page \{ size: A5 portrait; margin: 0; \}`\}<\/style>/);
});

test("top/bottom spacing comes from table header/footer spacers that repeat on every printed page", () => {
  assert.match(tsx, /<thead aria-hidden="true"><tr><td className="rx-pad" \/><\/tr><\/thead>/);
  assert.match(tsx, /<tfoot aria-hidden="true"><tr><td className="rx-pad" \/><\/tr><\/tfoot>/);
  assert.match(css, /\.rx-pad \{ height: 10mm; \}/);
  assert.match(css, /\.rx-paper:not\(\.rx-custom-paper\) \{ padding: 0 10mm !important; \}/);
});

test("signature and stamp areas stay removed from the printed sheet", () => {
  assert.doesNotMatch(tsx, /rx-sign|rx-stamp/);
});
