import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/prisma", () => ({ prisma: {} }));
import { registerDoctorSchema, registerPatientSchema, loginSchema } from "../src/modules/auth/auth.schema";
import { profileSchema } from "../src/modules/doctors/doctorProfile.schema";
import { createAppointmentSchema } from "../src/modules/appointments/appointments.schema";

const id = "11111111-1111-4111-8111-111111111111";
const doctor = { email: "d@example.com", password: "password123", firstName: "Amine", lastName: "Saidi", wilayaId: id, cityId: id };

describe("public input bounds", () => {
  it("still accepts a normal doctor registration", () => {
    expect(registerDoctorSchema.safeParse({ ...doctor, bio: "طبيب عام", languages: ["ar", "fr"] }).success).toBe(true);
  });

  it.each([
    ["oversized bio", { bio: "x".repeat(2001) }],
    ["too many languages", { languages: Array.from({ length: 11 }, (_, i) => `l${i}`) }],
    ["oversized language", { languages: ["x".repeat(41)] }],
    ["oversized name", { firstName: "x".repeat(61) }],
    ["oversized password", { password: "x".repeat(129) }],
  ])("rejects %s on the public doctor registration", (_label, extra) => {
    expect(registerDoctorSchema.safeParse({ ...doctor, ...extra }).success).toBe(false);
  });

  it("bounds patient registration and login", () => {
    expect(registerPatientSchema.safeParse({ email: "p@example.com", password: "password123", firstName: "x".repeat(61), lastName: "Ali" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "p@example.com", password: "x".repeat(129) }).success).toBe(false);
  });

  it("accepts https photos only and bounds profile text", () => {
    expect(profileSchema.safeParse({ photoUrl: "https://example.com/a.jpg" }).success).toBe(true);
    expect(profileSchema.safeParse({ photoUrl: "http://example.com/a.jpg" }).success).toBe(false);
    expect(profileSchema.safeParse({ address: "x".repeat(301) }).success).toBe(false);
    expect(profileSchema.safeParse({ bio: "x".repeat(4000) }).success).toBe(true);
  });

  it("bounds selected services on a booking", () => {
    const base = { doctorId: id, date: "2026-10-25", startTime: "09:00" };
    expect(createAppointmentSchema.safeParse({ ...base, serviceIds: [id] }).success).toBe(true);
    expect(createAppointmentSchema.safeParse({ ...base, serviceIds: Array(21).fill(id) }).success).toBe(false);
  });
});
