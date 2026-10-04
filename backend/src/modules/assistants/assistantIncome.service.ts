import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { algeriaTodayUTCMidnight } from "../../lib/slots";
import { FINANCE_SOURCE_SELECT, effectiveAppointmentPrice, revenueFromGroups } from "../../lib/clinicFinance";
import { assignedDoctors } from "./assistantBoard.service";

/**
 * المدخول اليومي لمساعد الاستقبال: إجمالي ما سُعِّر من مواعيد اليوم المكتملة (COMPLETED) لأطبائه المرتبطين فقط.
 * يعيد إجمالي اليوم وعدد الكشوفات المكتملة، دون أي نسبة طبيب/عيادة ودون أي سعر خاص بالطبيب أو عيادة غير مرتبطة.
 * النطاق = assignedDoctors (نفس فحص الطابور: تعطيل المساعد يقطع الوصول فورًا).
 */
export async function assistantDailyIncome(userId: string) {
  const doctors = await assignedDoctors(userId);
  const start = algeriaTodayUTCMidnight();
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  const date = { gte: start, lte: end };

  const perDoctor = await Promise.all(doctors.map(async (doctor) => {
    const where = { doctorId: doctor.id, status: AppointmentStatus.COMPLETED, date };
    const [completed, rows, source] = await Promise.all([
      prisma.appointment.count({ where }),
      prisma.appointmentFinancial.groupBy({ by: ["priceDzd", "doctorSharePercent"], _count: { _all: true }, where: { appointment: where } }),
      prisma.doctor.findUnique({ where: { id: doctor.id }, select: FINANCE_SOURCE_SELECT }),
    ]);
    const groups = rows.map((r) => ({ priceDzd: r.priceDzd, doctorSharePercent: r.doctorSharePercent, count: r._count._all }));
    const snapshotCount = groups.reduce((n, g) => n + g.count, 0);
    const price = source ? effectiveAppointmentPrice(source) : null;
    return { completed, grossDzd: revenueFromGroups(groups, completed - snapshotCount, price).grossDzd };
  }));

  return {
    date: start.toISOString().slice(0, 10),
    totalDzd: perDoctor.reduce((n, d) => n + d.grossDzd, 0),
    completedCount: perDoctor.reduce((n, d) => n + d.completed, 0),
  };
}
