import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prescriptionAgeValue, clearPrescriptionDraft, draftHasContent, emptyDraft, getStoredDraft, newMedication, prescriptionPatientFrom, shouldAutoRebind, storeDraft, validateDraft, samePrescriptionVisit, prescriptionVisitLabel,
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
  const good = validateDraft({ ...d, medications: [m1, { ...m2, name: "دواء ب", frequency: "عند الحاجة", duration: "حتى الموعد القادم" }, m3] });
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

 test("name alone is blocked with field errors; content is untouched", () => {
  const d = emptyDraft("u1", prescriptionPatientFrom(selfAppt));
  d.medications[0].directionsMode = "structured"; // Existing structured prescriptions retain validation.
  d.medications[0].name = "دواء تجريبي";
  const before = JSON.stringify(d);
  const result = validateDraft(d);
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.medicationErrors[d.medications[0].id]), ["dose", "frequency", "duration"]);
  assert.equal(JSON.stringify(d), before);
  d.medications[0].directionsMode = "freeText";
  assert.equal(validateDraft(d).ok, false);
  d.medications[0].instructions = "تعليمات كاملة يكتبها الطبيب حسب الحالة";
  assert.equal(validateDraft(d).ok, true);
  d.medications[0].directionsMode = "structured";
  assert.equal(validateDraft(d).ok, false);
 });
 test("visit identity: same person on two visits and two people with identical names", () => {
  const p = prescriptionPatientFrom(selfAppt);
  const next = { ...selfAppt, id: "second", startTime: "15:52" };
  assert.equal(samePrescriptionVisit(p, next), false);
  assert.equal(samePrescriptionVisit(p, { ...selfAppt, patientId: "different" }), false);
  const d = emptyDraft("u1", p, "current");
  d.medications[0].name = "دواء";
  assert.equal(shouldAutoRebind(d, next.id), false);
  assert.equal(d.patient.appointmentId, selfAppt.id);
  assert.match(prescriptionVisitLabel(p), /2026-10-10.*11:00/);
  assert.match(prescriptionVisitLabel(prescriptionPatientFrom(next)), /15:52/);
 });
 test("account holder and family member cannot share a prescription identity", () => {
  const p = prescriptionPatientFrom(familyAppt);
  const holder = { ...familyAppt, familyMemberId: null, familyMember: null, beneficiary: { type: "SELF", name: p.accountHolderName } } as unknown as Appointment;
  assert.equal(samePrescriptionVisit(p, holder), false);
  const d = emptyDraft("u1", p, "current");
  d.medications[0].name = "دواء";
  storeDraft(d);
  assert.equal(shouldAutoRebind(d, "another"), false);
  assert.equal(getStoredDraft("u1")?.patient.familyMemberId, "fm1");
  clearPrescriptionDraft();
 });

test('patient age is optional, validated, retained with the draft, and never auto-rebound to another patient', () => {
  const draft = emptyDraft('doctor', prescriptionPatientFrom(selfAppt), 'current');
  assert.equal(draft.patientAge, '');
  assert.equal(prescriptionAgeValue('23'), 23);
  assert.equal(prescriptionAgeValue('0'), 0);
  assert.equal(prescriptionAgeValue('2,5'), 2.5);
  assert.equal(prescriptionAgeValue('-1'), null);
  assert.equal(prescriptionAgeValue('151'), null);
  assert.equal(prescriptionAgeValue('six'), null);
  assert.equal(prescriptionAgeValue('6', 'months'), 6);
  const aged = { ...draft, patientAge: '23' };
  assert.equal(draftHasContent(aged), true);
  assert.equal(shouldAutoRebind(aged, 'different-visit'), false);
  storeDraft(aged);
  assert.equal(getStoredDraft('doctor')?.patientAge, '23');
  assert.equal(getStoredDraft('another-doctor'), null);
  assert.ok(validateDraft({ ...aged, patientAge: '-1' }).errors.includes('اكتب عمرًا صحيحًا للمريض أو اتركه فارغًا.'));
  assert.equal(emptyDraft('doctor', prescriptionPatientFrom(guestAppt)).patientAge, '');
  clearPrescriptionDraft();
});

test("بعد طباعة الوصفة وانتقال الطبيب للمريض التالي: وصفة فارغة جديدة باسم المريض الجديد", () => {
  const written = { ...emptyDraft("u1", prescriptionPatientFrom(familyAppt), "current"), medications: [{ ...newMedication(), name: "دواء" }] };
  // مكتوبة وغير مطبوعة: لا تُستبدل تلقائيًا (حماية عمل لم يُطبع)
  assert.equal(shouldAutoRebind(written, "a-self"), false);
  // مطبوعة: تنتقل إلى المريض الجديد
  const printed = { ...written, printedAt: "2026-10-23T10:00:00.000Z" };
  assert.equal(shouldAutoRebind(printed, "a-self"), true);
  // حتى لو كانت مختارة يدويًا لموعد آخر ثم طُبعت
  assert.equal(shouldAutoRebind({ ...printed, source: "manual" as const }, "a-self"), true);
  // نفس الزيارة أو لا مريض حالي: لا تغيير
  assert.equal(shouldAutoRebind(printed, "a-fam"), false);
  assert.equal(shouldAutoRebind(printed, null), false);
  // الوصفة الجديدة فارغة تمامًا: لا ينتقل أي دواء من المريض السابق
  const next = emptyDraft("u1", prescriptionPatientFrom(selfAppt), "current");
  assert.equal(draftHasContent(next), false);
  assert.equal(next.printedAt, undefined);
});

test("الوزن اختياري: يُقبل وزن صحيح ويُرفض غير الصحيح، ويُحسب كمحتوى في المسودة", async () => {
  const { prescriptionWeightValue } = await import("../src/lib/prescription.ts");
  assert.equal(prescriptionWeightValue("20"), 20);
  assert.equal(prescriptionWeightValue("12,5"), 12.5);
  assert.equal(prescriptionWeightValue(""), null);
  assert.equal(prescriptionWeightValue("0"), null);
  assert.equal(prescriptionWeightValue("abc"), null);
  assert.equal(prescriptionWeightValue("500"), null);
  const d = { ...emptyDraft("u1", prescriptionPatientFrom(selfAppt), "current"), patientWeight: "20" };
  assert.equal(draftHasContent(d), true);
  const bad = validateDraft({ ...d, medications: [{ ...newMedication("freeText"), name: "X", instructions: "مرتين يوميًا" }], patientWeight: "abc" });
  assert.ok(bad.errors.some(e => e.includes("وزنًا")));
});
