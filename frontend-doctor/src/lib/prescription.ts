import type { Appointment } from "../types/index.ts";

/**
 * منطق «كتابة وصفة» (نقي، يُختبر بـnode --test).
 * - الوصفة مرتبطة دائمًا بموعد واحد (appointmentId) والمستفيد الفعلي منه (familyMemberId يُحفظ كما هو).
 * - لا اقتراحات دوائية ولا جرعات تلقائية: كل الحقول يكتبها الطبيب.
 * - لا حفظ دائم حاليًا (لا يوجد جدول وصفات في قاعدة البيانات): المسودة في ذاكرة الصفحة فقط،
 *   تبقى عند التنقل داخل اللوحة وتُمسح عند تسجيل الخروج أو تغيير الحساب، ويُنبَّه قبل فقدانها.
 */

export interface PrescriptionMedication {
  id: string;
  name: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
}

/** المستفيد كما يُشتق من الموعد — لقطة ثابتة لا تتغيّر بتغيّر المريض الحالي. */
export interface PrescriptionPatient {
  appointmentId: string;
  /** صاحب الحساب المسؤول عن الحجز (فارغ لحجز الضيف). */
  patientId: string | null;
  /** المستفيد الفعلي إن كان فردًا من العائلة (يُحفظ كما هو). */
  familyMemberId: string | null;
  /** الاسم من بيانات الحجز (للمقارنة والتنبيه). */
  bookedName: string;
  /** صلة القرابة إن كان فرد عائلة. */
  relationship: string | null;
  /** صاحب الحساب حين يختلف عن المستفيد. */
  accountHolderName: string | null;
  appointmentDate: string;
  startTime: string;
}

export interface PrescriptionDraft {
  /** الحساب الذي كتب المسودة — لا تُعرض لحساب آخر على نفس الجهاز. */
  ownerUserId: string;
  patient: PrescriptionPatient;
  /** الاسم المطبوع على الوصفة: يبدأ باسم المستفيد ويمكن للطبيب تعديله (للوصفة فقط، لا يغيّر بيانات المريض). */
  patientName: string;
  medications: PrescriptionMedication[];
  notes: string;
  /** «current» = رُبطت تلقائيًا بالاستشارة الحالية، «manual» = اختارها الطبيب من موعد قائم. */
  source: "current" | "manual";
}

let seq = 0;
export function newMedication(): PrescriptionMedication {
  seq += 1;
  return { id: `med-${Date.now().toString(36)}-${seq}`, name: "", dose: "", frequency: "", duration: "", instructions: "" };
}

const RELATIONSHIP_AR: Record<string, string> = {
  CHILD: "ابن/ابنة",
  SPOUSE: "زوج/زوجة",
  PARENT: "أب/أم",
  SIBLING: "أخ/أخت",
  OTHER: "قريب",
};

/** المستفيد الفعلي من الموعد: فرد العائلة إن وُجد، ثم صاحب الحساب، ثم الضيف. */
export function prescriptionPatientFrom(a: Appointment): PrescriptionPatient {
  const familyMemberId = a.familyMemberId ?? a.familyMember?.id ?? a.beneficiary?.familyMemberId ?? null;
  const isFamily = Boolean(familyMemberId) || a.beneficiary?.type === "FAMILY_MEMBER";
  const holder = a.patient ? `${a.patient.firstName} ${a.patient.lastName}`.trim() : null;
  let bookedName: string;
  if (a.beneficiary?.type === "FAMILY_MEMBER" && a.beneficiary.name) bookedName = a.beneficiary.name;
  else if (a.familyMember) bookedName = `${a.familyMember.firstName} ${a.familyMember.lastName}`.trim();
  else if (holder) bookedName = holder;
  else bookedName = [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ").trim();
  const rel = a.familyMember?.relationship ?? a.beneficiary?.relationship ?? null;
  return {
    appointmentId: a.id,
    patientId: a.patientId ?? null,
    familyMemberId,
    bookedName,
    relationship: isFamily && rel ? RELATIONSHIP_AR[rel] ?? null : null,
    accountHolderName: isFamily ? holder : null,
    appointmentDate: a.date,
    startTime: a.startTime,
  };
}

export function emptyDraft(ownerUserId: string, patient: PrescriptionPatient, source: "current" | "manual" = "manual"): PrescriptionDraft {
  return { ownerUserId, patient, patientName: patient.bookedName, medications: [newMedication()], notes: "", source };
}

/**
 * هل نُعيد ربط المسودة تلقائيًا بالمريض الحالي الجديد؟ فقط إن كانت مرتبطة تلقائيًا بالاستشارة السابقة
 * وفارغة. أي محتوى مكتوب لا ينتقل أبدًا إلى مريض آخر، واختيار الطبيب اليدوي لا يُلغى تلقائيًا.
 */
export function shouldAutoRebind(d: PrescriptionDraft | null, currentAppointmentId: string | null): boolean {
  if (!currentAppointmentId) return false;
  if (!d) return true;
  if (d.patient.appointmentId === currentAppointmentId) return false;
  return d.source === "current" && !draftHasContent(d);
}

const filled = (m: PrescriptionMedication) => [m.name, m.dose, m.frequency, m.duration, m.instructions].some((v) => v.trim() !== "");

/** هل كتب الطبيب شيئًا يُفقد؟ (تعديل الاسم وحده لا يُعدّ محتوى طبيًا لكنه يُحتسب كتعديل). */
export function draftHasContent(d: PrescriptionDraft | null | undefined): boolean {
  if (!d) return false;
  return d.medications.some(filled) || d.notes.trim() !== "" || d.patientName.trim() !== d.patient.bookedName.trim();
}

export interface DraftValidation {
  ok: boolean;
  errors: string[];
  /** الأدوية التي ستُطبع فعلًا (الصفوف الفارغة كليًا تُتجاهل). */
  printable: PrescriptionMedication[];
}

export function validateDraft(d: PrescriptionDraft): DraftValidation {
  const errors: string[] = [];
  if (!d.patientName.trim()) errors.push("اكتب اسم المريض.");
  const rows = d.medications.filter(filled);
  if (rows.length === 0) errors.push("أضف دواءً واحدًا على الأقل.");
  rows.forEach((m, i) => {
    if (!m.name.trim()) errors.push(`الدواء رقم ${i + 1}: اسم الدواء مطلوب.`);
  });
  return { ok: errors.length === 0, errors, printable: rows.map((m) => ({ ...m, name: m.name.trim() })) };
}

// ---------------- مخزن المسودة في الذاكرة (لا localStorage: بيانات طبية على جهاز قد يكون مشتركًا) ----------------

let currentDraft: PrescriptionDraft | null = null;

export function getStoredDraft(ownerUserId: string | undefined): PrescriptionDraft | null {
  if (!currentDraft || !ownerUserId || currentDraft.ownerUserId !== ownerUserId) return null;
  return currentDraft;
}

export function storeDraft(d: PrescriptionDraft | null): void {
  currentDraft = d;
}

/** يُستدعى عند تسجيل الخروج: لا تبقى أي وصفة في ذاكرة الصفحة. */
export function clearPrescriptionDraft(): void {
  currentDraft = null;
}
