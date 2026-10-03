import test from "node:test";
import assert from "node:assert/strict";
import { beneficiaryName, padTurn, visibleTurnNumbers } from "../src/lib/appointmentPeople.ts";

const base = { doctorId: "d", date: "2026-10-03", endTime: "00:00", type: "IN_PERSON", status: "CONFIRMED" } as const;
const appt = (id: string, startTime: string, extra: Record<string, unknown> = {}) => ({ ...base, id, startTime, ...extra }) as any;

test("رقم الدور: ترتيب وقت الموعد وثابت عند التعادل بالمعرّف", () => {
  const list = [appt("b", "10:30"), appt("a", "10:30"), appt("c", "09:00")];
  const turns = visibleTurnNumbers(list);
  assert.equal(turns.get("c"), 1);
  assert.equal(turns.get("a"), 2);
  assert.equal(turns.get("b"), 3);
});

test("رقم الدور لا يتغير بترتيب القائمة المدخلة", () => {
  const list = [appt("a", "09:00"), appt("b", "09:30"), appt("c", "10:00")];
  const forward = visibleTurnNumbers(list);
  const reversed = visibleTurnNumbers([...list].reverse());
  for (const id of ["a", "b", "c"]) assert.equal(forward.get(id), reversed.get(id));
});

test("padTurn", () => {
  assert.equal(padTurn(5), "05");
  assert.equal(padTurn(12), "12");
  assert.equal(padTurn(undefined), "—");
});

test("اسم المستفيد: فرد العائلة ثم صاحب الحساب ثم الضيف (بلا ربط بالهوية)", () => {
  assert.equal(beneficiaryName(appt("1", "09:00", { beneficiary: { type: "FAMILY_MEMBER", name: "طفل افتراضي" }, patient: { firstName: "أم", lastName: "افتراضية" } })), "طفل افتراضي");
  assert.equal(beneficiaryName(appt("2", "09:00", { patient: { firstName: "مريض", lastName: "تجريبي" } })), "مريض تجريبي");
  assert.equal(beneficiaryName(appt("3", "09:00", { guestFirstName: "زائر", guestLastName: "تجريبي" })), "زائر تجريبي");
  assert.equal(beneficiaryName(appt("4", "09:00")), "مريض بدون اسم");
});

test("اسم المستفيد من بيانات الطابور (familyMember بلا beneficiary) لا يعرض صاحب الحساب", () => {
  const fromQueue = appt("q", "09:00", { patientId: "p", patient: { firstName: "أحمد", lastName: "التجريبي" }, familyMemberId: "f", familyMember: { id: "f", firstName: "يوسف", lastName: "التجريبي", relationship: "CHILD" } });
  assert.equal(beneficiaryName(fromQueue), "يوسف التجريبي");
});
