import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { beneficiaryLabel, bookableMembers, filterByBeneficiary, validateMemberForm, RELATIONSHIP_OPTIONS } from "../src/lib/family.ts";
import { counterCardText } from "../src/lib/bookingStats.ts";

const self = { id: "1", beneficiary: { type: "SELF", name: "سارة", relationship: null, familyMemberId: null } } as any;
const kid = { id: "2", familyMemberId: "k", beneficiary: { type: "FAMILY_MEMBER", name: "ياسين", relationship: "CHILD", familyMemberId: "k" } } as any;
const mom = { id: "3", familyMemberId: "m", beneficiary: { type: "FAMILY_MEMBER", name: "فاطمة", relationship: "PARENT", familyMemberId: "m" } } as any;

test("beneficiary filter: me / whole family / one member", () => {
  assert.deepEqual(filterByBeneficiary([self, kid, mom], "all").map((a) => a.id), ["1", "2", "3"]);
  assert.deepEqual(filterByBeneficiary([self, kid, mom], "self").map((a) => a.id), ["1"]);
  assert.deepEqual(filterByBeneficiary([self, kid, mom], "k").map((a) => a.id), ["2"]);
});

test("beneficiary label shows the name and relationship before confirming", () => {
  assert.equal(beneficiaryLabel(kid.beneficiary), "ياسين (ابن/ابنة)");
  assert.equal(beneficiaryLabel(self.beneficiary), "أنا (صاحب الحساب)");
  assert.equal(beneficiaryLabel(undefined), "أنا (صاحب الحساب)");
  assert.equal(RELATIONSHIP_OPTIONS.length, 5);
});

test("archived members are not offered for new bookings", () => {
  const list = [{ id: "a", archivedAt: null }, { id: "b", archivedAt: "2026-09-01" }] as any;
  assert.deepEqual(bookableMembers(list).map((m) => m.id), ["a"]);
  assert.deepEqual(bookableMembers(undefined), []);
});

test("member form validation (Arabic messages)", () => {
  assert.deepEqual(validateMemberForm({ firstName: "ياسين", lastName: "بن علي", relationship: "CHILD" }), {});
  const e = validateMemberForm({ firstName: "ي", lastName: "", relationship: "X", birthDate: "2999-01-01" });
  assert.equal(e.firstName, "الاسم قصير جدًا");
  assert.ok(e.lastName && e.relationship && e.birthDate);
});

test("booking counter card hides safely on error/loading/odd data and never shows a small exact number", () => {
  const ok = { displayText: "تم حجز 42 موعدًا هذا الشهر", displayCount: 42 } as any;
  assert.equal(counterCardText({ data: ok }), "تم حجز 42 موعدًا هذا الشهر");
  assert.equal(counterCardText({ isError: true, data: ok }), null);
  assert.equal(counterCardText({ isLoading: true }), null);
  assert.equal(counterCardText({ data: null }), null);
  assert.equal(counterCardText({ data: { displayText: "", displayCount: null } as any }), null);
  assert.equal(counterCardText({ data: { displayText: "تم حجز 3 مواعيد", displayCount: 3 } as any }), null);
  assert.equal(counterCardText({ data: { displayText: "بدأ المرضى بالحجز عبر MedBook هذا الشهر", displayCount: null } as any }), "بدأ المرضى بالحجز عبر MedBook هذا الشهر");
});

test("no family or treatment data is written to localStorage or Cache Storage by the new pages", () => {
  for (const f of ["src/pages/account/FamilyMembers.tsx", "src/pages/account/TreatmentPlans.tsx", "src/components/booking/BeneficiaryPicker.tsx", "src/lib/family.ts"]) {
    const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /localStorage|sessionStorage|caches\.|indexedDB/, f);
  }
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(sw, /family|treatment/i);
});
