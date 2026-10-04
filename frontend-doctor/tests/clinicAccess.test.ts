import assert from "node:assert/strict";
import test from "node:test";
import { canManageClinic, canOpenClinic } from "../src/lib/clinicAccess.ts";

const user = (doctor: object = {}) => ({ id: "member", role: "DOCTOR" as const, doctor: { clinic: { id: "clinic", ownerId: "owner" }, ...doctor } } as Parameters<typeof canManageClinic>[0]);
test("clinic members see no management entry or direct route", () => {
  assert.equal(canManageClinic(user()), false);
  assert.equal(canOpenClinic(user()), false);
});
test("owner and appointed manager can open management", () => {
  assert.equal(canManageClinic({ ...user()!, id: "owner" }), true);
  assert.equal(canManageClinic(user({ clinicManagerForId: "clinic" })), true);
});
test("delegation does not survive a clinic transfer", () => {
  assert.equal(canOpenClinic(user({ clinicManagerForId: "old-clinic" })), false);
});
test("independent doctors can create a clinic without seeing management mode", () => {
  assert.equal(canOpenClinic(user({ clinic: null })), true);
  assert.equal(canManageClinic(user({ clinic: null })), false);
});
test("assistant and patient contexts cannot use ownership for management", () => {
  for (const role of ["ASSISTANT", "PATIENT"] as const) assert.equal(canOpenClinic({ ...user()!, role, ownedClinic: { id: "clinic", nameAr: "test", address: "test" } }), false);
});
