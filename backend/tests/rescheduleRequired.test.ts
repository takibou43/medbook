import { describe, it, expect } from "vitest";
import { AppointmentStatus } from "@prisma/client";
import { markRescheduleWhere } from "../src/modules/doctors/doctorSelf.service";
import { REMINDABLE_STATUSES } from "../src/modules/reminders/reminders.service";
import { WAITING_QUEUE_STATUSES } from "../src/lib/doctorQueue";
import { EXPIRABLE_STATUSES, canTransition } from "../src/modules/appointments/appointments.service";

const R = AppointmentStatus.RESCHEDULE_REQUIRED;

describe("RESCHEDULE_REQUIRED — موعد غير صالح للحضور", () => {
  it("لا يُحوَّل إلا موعد ما يزال PENDING/CONFIRMED لحظة الكتابة (حماية من السباق)", () => {
    const where = markRescheduleWhere([{ id: "a" }, { id: "b" }]);
    expect(where.id.in).toEqual(["a", "b"]);
    expect([...where.status.in].sort()).toEqual([AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING].sort());
  });

  it("لا تذكيرات، ولا طابور، ولا غياب تلقائي عند الإغلاق", () => {
    expect(REMINDABLE_STATUSES).not.toContain(R);
    expect(WAITING_QUEUE_STATUSES).not.toContain(R);
    expect(EXPIRABLE_STATUSES).not.toContain(R);
  });

  it("لا يُنادى ولا يُنهى ولا يُسجَّل غيابًا؛ الإلغاء وحده مسموح", () => {
    for (const role of ["DOCTOR", "ASSISTANT", "PATIENT"] as const) {
      for (const to of [AppointmentStatus.IN_PROGRESS, AppointmentStatus.LATE, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW, AppointmentStatus.CONFIRMED]) {
        expect(canTransition(role, R, to)).toBe(false);
      }
    }
    expect(canTransition("PATIENT", R, AppointmentStatus.CANCELLED)).toBe(true);
  });
});
