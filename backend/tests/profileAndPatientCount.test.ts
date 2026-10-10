import { describe, it, expect } from "vitest";
import { profileSchema } from "../src/modules/doctors/doctorProfile.schema";
import { countPatients, patientKey } from "../src/lib/doctorPatients";

describe("profile experience boundary", () => {
  it.each([-5, 1.5, "abc"])("rejects invalid years %s", yearsExperience => {
    expect(profileSchema.safeParse({ yearsExperience }).success).toBe(false);
  });
  it.each([0, 1, 35])("accepts whole nonnegative years %s", yearsExperience => {
    expect(profileSchema.parse({ yearsExperience }).yearsExperience).toBe(yearsExperience);
  });
});

describe("dashboard beneficiary count", () => {
  it("uses list identity for self, family, distinct accounts and guests", () => {
    const rows = [
      { id: "1", patientId: "p", familyMemberId: null, guestPhone: null },
      { id: "2", patientId: "p", familyMemberId: null, guestPhone: null },
      { id: "3", patientId: "p", familyMemberId: "child", guestPhone: null },
      { id: "4", patientId: "q", familyMemberId: null, guestPhone: null },
      { id: "5", patientId: null, familyMemberId: null, guestPhone: "0550000000" },
      { id: "6", patientId: null, familyMemberId: null, guestPhone: "0550000000" },
      { id: "7", patientId: null, familyMemberId: null, guestPhone: null },
      { id: "8", patientId: null, familyMemberId: null, guestPhone: null },
    ];
    expect(countPatients(rows)).toBe(6);
    expect(countPatients(rows)).toBe(new Set(rows.map(patientKey)).size);
    expect(countPatients([])).toBe(0);
  });
});
