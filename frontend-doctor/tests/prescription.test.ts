import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearPrescriptionDraft, draftHasContent, emptyDraft, getStoredDraft, newMedication, prescriptionPatientFrom, shouldAutoRebind, storeDraft, validateDraft,
} from "../src/lib/prescription.ts";
import type { Appointment } from "../src/types/index.ts";

const base = { doctorId: "d1", date: "2026-10-10T00:00:00.000Z", endTime: "09:30", type: "IN_PERSON", status: "IN_PROGRESS" } as const;

const familyAppt = {
  ...base, id: "a-fam", startTime: "09:00", patientId: "p1", familyMemberId: "fm1",
  patient: { firstName: "سمير", lastName: "بوعلام" },
  beneficiary: { type: "FAMILY_MEMBER", name: "ياسين بوعلام", relationship: "CHILD", familyMemberId: "fm1" },
} as unknown as Appointment;

const queueFamilyAppt = {
  ...base, id: "a-q", startTime: "10:00", patientId: "p2", familyMemberId: "fm2",
  patient: { firstName: "نادية", lastName: "قاسمي" },
  familyMember: { id: "fm2", firstName: "ليلى", lastName: "قاسمي", relationship: "PARENT" },
} as unknown as Appointment;

const selfAppt = { ...base, id: "a-self", startTime: "11:00", patientId: "p3", patient: { firstName: "كريم", lastName: "حداد" } } as unknown as Appointment;
const guestAppt = { ...base, id: "a-guest", startTime: "12:00", patientId: null, guestFirstName: "أمينة", guestLastName: "زروقي" } as unknown as Appointment;

test("المستفيد الفعلي: فرد العائلة مع الحفاظ على familyMemberId", () => {
  const p = prescriptionPatientFrom(familyAppt);
  assert.equal(p.bookedName, "ياسين بوعلام");
  assert.equal(p.familyMemberId, "fm1");
  assert.equal(p.patientId, "p1");
  assert.equal(p.accountHolderName, "سمير بوعلام");
  assert.equal(p.relationship, "ابن/ابنة");
  // شكل الطابور (familyMember بدل beneficiary)
  const q = prescriptionPatientFrom(queueFamilyAppt);
  assert.equal(q.bookedName, "ليلى قاسمي");
  assert.equal(q.familyMemberId, "fm2");
});

test("صاحب الحساب والضيف", () => {
  const s = prescriptionPatientFrom(selfAppt);
  assert.deepEqual([s.bookedName, s.familyMemberId, s.accountHolderName, s.relationship], ["كريم حداد", null, null, null]);
  const g = prescriptionPatientFrom(guestAppt);
  assert.deepEqual([g.bookedName, g.patientId], ["أمينة زروقي", null]);
});

test("تعديل اسم المريض للوصفة فقط لا يغيّر المستفيد المرتبط", () => {
  const d = emptyDraft("u1", prescriptionPatientFrom(familyAppt), "current");
  const edited = { ...d, patientName: "ياسين س. بوعلام" };
  assert.equal(edited.patient.bookedName, "ياسين بوعلام");
  assert.equal(edited.patient.familyMemberId, "fm1");
  assert.equal(draftHasContent(edited), true);
  assert.equal(draftHasContent(d), false);
});

test("التحقق قبل المعاينة: دواء واحد على الأقل باسم، والصفوف الفارغة تُتجاهل", () => {
  const d = emptyDraft("u1", prescriptionPatientFrom(selfAppt));
  assert.equal(validateDraft(d).ok, false);
  const m1 = { ...newMedication(), name: "  دواء أ ", dose: "1", frequency: "2", duration: "5 أيام" };
  const m2 = { ...newMedication(), dose: "نصف قرص" }; // بلا اسم
  const m3 = newMedication(); // فارغ تمامًا
  const bad = validateDraft({ ...d, medications: [m1, m2, m3] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes("رقم 2")));
  const good = validateDraft({ ...d, medications: [m1, { ...m2, name: "دواء ب" }, m3] });
  assert.equal(good.ok, true);
  assert.deepEqual(good.printable.map((m) => m.name), ["دواء أ", "دواء ب"]);
  assert.equal(validateDraft({ ...d, patientName: "  ", medications: [m1] }).ok, false);
});

test("عزل المسودات: محتوى مريض لا ينتقل لمريض آخر تلقائيًا", () => {
  const empty = emptyDraft("u1", prescriptionPatientFrom(familyAppt), "current");
  assert.equal(shouldAutoRebind(null, "a-self"), true);
  assert.equal(shouldAutoRebind(empty, "a-fam"), false); // نفس المريض
  assert.equal(shouldAutoRebind(empty, "a-self"), true); // فارغة ومرتبطة تلقائيًا: تنتقل
  const written = { ...empty, medications: [{ ...newMedication(), name: "دواء" }] };
  assert.equal(shouldAutoRebind(written, "a-self"), false); // مكتوبة: لا تنتقل
  const manual = emptyDraft("u1", prescriptionPatientFrom(guestAppt), "manual");
  assert.equal(shouldAutoRebind(manual, "a-self"), false); // اختيار يدوي لا يُلغى
  assert.equal(shouldAutoRebind(written, null), false);
});

test("المخزن المؤقت: لا يُعرض لحساب آخر ويُمسح عند الخروج", () => {
  const d = emptyDraft("u1", prescriptionPatientFrom(selfAppt));
  storeDraft(d);
  assert.equal(getStoredDraft("u1"), d);
  assert.equal(getStoredDraft("u2"), null);
  assert.equal(getStoredDraft(undefined), null);
  clearPrescriptionDraft();
  assert.equal(getStoredDraft("u1"), null);
});
