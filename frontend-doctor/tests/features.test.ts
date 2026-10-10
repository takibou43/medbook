import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addMonthsDay, algeriaDay, beneficiaryText, canScheduleFollowUp, isDentalSpecialty,
  referralCodeFromSearch, referralLink, REFERRAL_STATUS_LABELS,
} from "../src/lib/features.ts";

test("doctor sees the correct beneficiary name (family member with relationship, else the booked name)", () => {
  assert.equal(beneficiaryText({ beneficiary: { type: "FAMILY_MEMBER", name: "ياسين ع", relationship: "CHILD", familyMemberId: "k" }, patient: { firstName: "سارة", lastName: "ع" } } as any), "ياسين ع (ابن/ابنة)");
  assert.equal(beneficiaryText({ guestFirstName: "سارة", guestLastName: "ع", patient: { firstName: "x", lastName: "y" } } as any), "سارة ع");
  assert.equal(beneficiaryText({ patient: { firstName: "سارة", lastName: "ع" } } as any), "سارة ع");
});

test("follow-up requires an account or complete guest identity and a non-cancelled appointment", () => {
  assert.equal(canScheduleFollowUp({ patientId: "p", status: "COMPLETED" } as any), true);
  assert.equal(canScheduleFollowUp({ patientId: null, status: "COMPLETED" } as any), false);
  assert.equal(canScheduleFollowUp({ patientId: null, status: "COMPLETED", guestFirstName: "Ahmed", guestLastName: "Test", guestPhone: "0550000000" }), true);
  assert.equal(canScheduleFollowUp({ patientId: null, status: "COMPLETED", guestFirstName: "Ahmed", guestLastName: "Test", guestPhone: " " }), false);
  assert.equal(canScheduleFollowUp({ patientId: null, status: "CANCELLED", guestFirstName: "Ahmed", guestLastName: "Test", guestPhone: "0550000000" }), false);
  assert.equal(canScheduleFollowUp({ patientId: "p", status: "CANCELLED" } as any), false);
});

test("dental specialty detection mirrors the server helper", () => {
  assert.equal(isDentalSpecialty({ nameAr: "طب الأسنان", nameFr: "Dentisterie" }), true);
  assert.equal(isDentalSpecialty({ nameAr: "طب الاسنان" }), true);
  assert.equal(isDentalSpecialty({ nameAr: "طب عام", nameFr: "Médecine générale" }), false);
  assert.equal(isDentalSpecialty(undefined), false);
});

test("referral link/code helpers and honest status labels", () => {
  assert.equal(referralLink("https://medbook-doctor.vercel.app/", "MB-ABCDEFGH"), "https://medbook-doctor.vercel.app/register?ref=MB-ABCDEFGH");
  assert.equal(referralCodeFromSearch("?ref=mb-abcdefgh"), "MB-ABCDEFGH");
  assert.equal(referralCodeFromSearch(""), "");
  // «تمت إضافة 30 يومًا» لا تظهر إلا للحالة REWARDED.
  for (const [k, v] of Object.entries(REFERRAL_STATUS_LABELS)) assert.equal(v.includes("30"), k === "REWARDED");
});

test("Algeria calendar dates for the follow-up picker", () => {
  assert.equal(algeriaDay(0, Date.parse("2026-09-29T23:30:00Z")), "2026-09-30");
  assert.equal(addMonthsDay("2026-08-31", 6), "2027-02-28");
  assert.equal(addMonthsDay("2026-09-30", 6), "2027-03-30");
});

test("follow-up UI never promises SMS", () => {
  for (const f of ["src/components/FollowUpModal.tsx", "src/pages/doctor/DoctorTreatmentPlans.tsx"]) {
    const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /SMS|رسالة نصية/, f);
  }
  const modal = readFileSync(new URL("../src/components/FollowUpModal.tsx", import.meta.url), "utf8");
  assert.match(modal, /تمت برمجة موعد العودة وإشعار المريض داخل MedBook\./);
  assert.match(modal, /idempotencyKey/);
});
