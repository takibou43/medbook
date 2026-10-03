import type { Appointment } from "../types";

/** اسم المستفيد الفعلي: فرد العائلة إن وُجد، ثم صاحب الحساب، ثم الضيف. */
export function beneficiaryName(a: Appointment): string {
  if (a.beneficiary?.type === "FAMILY_MEMBER") return a.beneficiary.name;
  if (a.patient) return `${a.patient.firstName} ${a.patient.lastName}`.trim();
  return [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ").trim() || "مريض بدون اسم";
}

export function appointmentPhone(a: Appointment): string | null {
  return a.patient?.user?.phone ?? a.guestPhone ?? null;
}

/**
 * رقم الدور المرئي: ترتيب مواعيد اليوم بوقت الموعد، وعند التعادل بالمعرّف (ثابت).
 * للعرض فقط — ترتيب المناداة الفعلي مصدره الخادم (queue.ordered) ولا يتأثر بهذا الرقم.
 */
export function visibleTurnNumbers(appointments: Appointment[]): Map<string, number> {
  const sorted = [...appointments].sort((x, y) => x.startTime.localeCompare(y.startTime) || x.id.localeCompare(y.id));
  return new Map(sorted.map((a, i) => [a.id, i + 1]));
}

export function padTurn(n: number | undefined): string {
  return n === undefined ? "—" : String(n).padStart(2, "0");
}
