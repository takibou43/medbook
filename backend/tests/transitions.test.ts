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

  it("لا يسمح بأي انتقال من حالة نهائية (COMPLETED/CANCELLED)", () => {
    expect(canTransition("DOCTOR", "COMPLETED", "CONFIRMED")).toBe(false);
    expect(canTransition("ADMIN", "CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("DOCTOR", "COMPLETED", "IN_PROGRESS")).toBe(false);
  });

  // المريض الذي سُجّل غيابه ثم وصل بعد دقائق: الطبيب يُدخله الآن (IN_PROGRESS) فقط.
  // CONFIRMED ممنوعة عمدًا لأن autoExpireStaleAppointments تُعيدها إلى NO_SHOW بعد الإغلاق.
  it("يسمح للطبيب بإرجاع موعد NO_SHOW إلى IN_PROGRESS فقط (حضر متأخرًا)", () => {
    expect(canTransition("DOCTOR", "NO_SHOW", "IN_PROGRESS")).toBe(true);
    expect(canTransition("DOCTOR", "NO_SHOW", "CONFIRMED")).toBe(false);
    expect(canTransition("DOCTOR", "NO_SHOW", "PENDING")).toBe(false);
    expect(canTransition("DOCTOR", "NO_SHOW", "LATE")).toBe(false);
    expect(canTransition("DOCTOR", "NO_SHOW", "COMPLETED")).toBe(false);
    expect(canTransition("DOCTOR", "NO_SHOW", "CANCELLED")).toBe(false);
  });

  it("المريض والإدارة لا يملكان هذا الاستثناء — NO_SHOW تبقى نهائية لديهما", () => {
    expect(canTransition("PATIENT", "NO_SHOW", "IN_PROGRESS")).toBe(false);
    expect(canTransition("ADMIN", "NO_SHOW", "IN_PROGRESS")).toBe(false);
  });

  it("الإدارة يمكنها تأكيد أو إلغاء موعد PENDING مثل الطبيب", () => {
    expect(canTransition("ADMIN", "PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("ADMIN", "PENDING", "CANCELLED")).toBe(true);
  });
});
