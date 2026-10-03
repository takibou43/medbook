import assert from "node:assert/strict";
import test from "node:test";
import { clinicInviteReturnPath, canAcceptClinicInvite } from "../src/lib/clinicInvite.ts";

test("login resumes only a valid local clinic invitation", () => {
  const path = `/clinic/doctor/accept/${"a".repeat(64)}`;
  assert.equal(clinicInviteReturnPath(path), path);
  for (const invalid of [null, {}, "https://example.com", "//example.com", path + "?next=https://example.com", "/admin", path.replace("a", "z")]) {
    assert.equal(clinicInviteReturnPath(invalid), null);
  }
});
test("only the invited email in doctor context can accept", () => {
  assert.equal(canAcceptClinicInvite({ role: "DOCTOR", email: "Doctor@Example.com" }, "doctor@example.com"), true);
  assert.equal(canAcceptClinicInvite({ role: "DOCTOR", email: "other@example.com" }, "doctor@example.com"), false);
  assert.equal(canAcceptClinicInvite({ role: "PATIENT", email: "doctor@example.com" }, "doctor@example.com"), false);
  assert.equal(canAcceptClinicInvite(null, "doctor@example.com"), false);
});
