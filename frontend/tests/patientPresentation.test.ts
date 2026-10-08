import assert from "node:assert/strict";
import test from "node:test";
import { arabicDate, directionsUrl, patientName, platformText, timeGroups } from "../src/lib/patientPresentation.ts";

test("family identity never falls back to the account owner", () => {
  assert.equal(patientName({type:"FAMILY_MEMBER", name:"ياسين بن علي", relationship:"CHILD", familyMemberId:"child"}), "ياسين بن علي (ابن/ابنة)");
  assert.equal(patientName({type:"SELF", name:"سارة بن علي", relationship:null, familyMemberId:null}), "سارة بن علي");
  assert.equal(patientName(undefined), "اسم المستفيد غير متاح");
});
test("128 times remain available once, in chronological morning/evening groups", () => {
  const times = Array.from({length:128}, (_,i) => `${String(6 + Math.floor(i/8)).padStart(2,"0")}:${String(i%8*7).padStart(2,"0")}`);
  const groups = timeGroups(times);
  assert.deepEqual(groups.flatMap(g => g.times), times);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].times.length, 48);
  assert.equal(groups[1].times[0], "12:00");
});
test("directions require recorded address or valid coordinates, never a city centroid", () => {
  assert.equal(directionsUrl(null,"ميلة","ميلة"), null);
  assert.equal(directionsUrl(null,undefined,undefined,NaN,200), null);
  assert.match(directionsUrl("حي المكي", "ميلة", "ميلة")!, /destination=/);
  assert.match(directionsUrl(null,undefined,undefined,36.4,6.2)!, /36.4%2C6.2/);
});
test("Arabic appointment date is independent of browser timezone and ISO suffix", () => {
  assert.equal(arabicDate("2026-10-09"), arabicDate("2026-10-09T00:00:00.000Z"));
  assert.equal(arabicDate("2026-10-08T23:30:00Z"), arabicDate("2026-10-09"));
  assert.match(arabicDate("2026-10-09"), /2026|٢٠٢٦/);
  assert.equal(arabicDate(undefined), "التاريخ غير متاح");
  assert.equal(arabicDate("invalid"), "التاريخ غير متاح");
});
test("old notification branding is presented consistently without altering stored messages", () => {
  const original = "انضم طبيب جديد إلى مادبوك. MadBook";
  assert.equal(platformText(original), "انضم طبيب جديد إلى MedBook. MedBook");
  assert.equal(original, "انضم طبيب جديد إلى مادبوك. MadBook");
});
