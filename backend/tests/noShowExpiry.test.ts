import { describe, expect, it } from "vitest";
import { AppointmentStatus } from "@prisma/client";
import { EXPIRABLE_STATUSES, classifyDueAppointments } from "../src/modules/appointments/appointments.service";

// قاعدة المشروع: الغياب لا يُعتمد عند الضغط على «لم يحضر» أثناء المناداة، بل وحده عند
// انتهاء دوام الطبيب. هذه الاختبارات تحمي شرطَي الاعتماد: أي الحالات تُمسّ، وإلى أي
// حالة تنتهي — بلا حذف أي سجل من قاعدة البيانات.

describe("اعتماد الغياب عند انتهاء الدوام", () => {
  it("لا يُرشَّح للاعتماد إلا غير المحسوم: مؤكّد/متأخر/بالداخل", () => {
    expect(EXPIRABLE_STATUSES).toEqual([
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.LATE,
      AppointmentStatus.IN_PROGRESS,
    ]);
  });

  it("لا يمسّ المكتمل ولا الملغى ولا المعلّق ولا المعتمد أصلًا كغياب", () => {
    for (const status of [
      AppointmentStatus.COMPLETED,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.PENDING,
      AppointmentStatus.NO_SHOW,
    ]) {
      expect(EXPIRABLE_STATUSES).not.toContain(status);
    }
  });

  it("المتأخر والمؤكّد يصيران غيابًا نهائيًا، ومن كان بالداخل يصير مكتملًا", () => {
    const { seen, missed } = classifyDueAppointments([
      { id: "late-1", status: AppointmentStatus.LATE },
      { id: "confirmed-1", status: AppointmentStatus.CONFIRMED },
      { id: "inside-1", status: AppointmentStatus.IN_PROGRESS },
    ]);

    expect(missed).toEqual(["late-1", "confirmed-1"]);
    expect(seen).toEqual(["inside-1"]);
  });

  it("قائمة فارغة لا تُنتج أي تحديث (تشغيل متكرر بلا أثر)", () => {
    const { seen, missed } = classifyDueAppointments([]);
    expect(seen).toHaveLength(0);
    expect(missed).toHaveLength(0);
  });
});
