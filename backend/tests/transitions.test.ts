import { describe, it, expect } from "vitest";
import { canTransition } from "../src/modules/appointments/appointments.service";

describe("canTransition — حالات الموعد (Appointment Status)", () => {
  it("يسمح للمريض بإلغاء موعد PENDING", () => {
    expect(canTransition("PATIENT", "PENDING", "CANCELLED")).toBe(true);
  });

  it("لا يسمح للمريض بتأكيد موعد بنفسه", () => {
    expect(canTransition("PATIENT", "PENDING", "CONFIRMED")).toBe(false);
  });

  it("يسمح للطبيب بتأكيد أو رفض موعد PENDING", () => {
    expect(canTransition("DOCTOR", "PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("DOCTOR", "PENDING", "CANCELLED")).toBe(true);
  });

  it("يسمح للطبيب بإنهاء موعد CONFIRMED أو تسجيل عدم حضور", () => {
    expect(canTransition("DOCTOR", "CONFIRMED", "COMPLETED")).toBe(true);
    expect(canTransition("DOCTOR", "CONFIRMED", "NO_SHOW")).toBe(true);
  });

  it("لا يسمح بأي انتقال من حالة نهائية (COMPLETED/CANCELLED/NO_SHOW)", () => {
    expect(canTransition("DOCTOR", "COMPLETED", "CONFIRMED")).toBe(false);
    expect(canTransition("ADMIN", "CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("DOCTOR", "NO_SHOW", "COMPLETED")).toBe(false);
  });

  it("الإدارة يمكنها تأكيد أو إلغاء موعد PENDING مثل الطبيب", () => {
    expect(canTransition("ADMIN", "PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("ADMIN", "PENDING", "CANCELLED")).toBe(true);
  });
});
