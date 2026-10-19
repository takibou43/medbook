import type { Appointment } from "../types/index.ts";
import type { PrescriptionLanguage, PrescriptionProfessional } from "./prescriptionPrint.ts";
import { structuredErrors } from "./prescriptionMedication.ts";

/**
 * منطق «كتابة وصفة» (نقي، يُختبر بـnode --test).
 * - الوصفة مرتبطة دائمًا بموعد واحد (appointmentId) والمستفيد الفعلي منه (familyMemberId يُحفظ كما هو).
 * - اقتراح أسماء سبق للطبيب إدخالها فقط؛ الجرعات يكتبها الطبيب.
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
  /** الكمية المصروفة كما كتبها الطبيب، مستقلة عن الجرعة. */
  quantity?: string;
  directionsMode?: "structured" | "freeText";
  /** حقول اختيارية جديدة: التركيز والشكل، والجرعة/التكرار/التوقيت/المدة المنظمة (القيم النصية القديمة تبقى كما كُتبت). */
  strength?: string;
  form?: string;
  doseQty?: string;
  doseUnit?: string;
  doseCustom?: string;
  freqKey?: string;
  freqCustom?: string;
  timingKey?: string;
  timingCustom?: string;
  durQty?: string;
  durUnit?: string;
  durCustom?: string;
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

/** عنصر طلب (تحليل أو أشعة/فحص) كما يكتبه الطبيب؛ الملاحظة اختيارية. */
export interface PrescriptionRequestItem { id: string; name: string; note: string }

export function newRequestItem(): PrescriptionRequestItem {
  seq += 1;
  return { id: `req-${Date.now().toString(36)}-${seq}`, name: "", note: "" };
}
export const requestFilled = (r: PrescriptionRequestItem) => r.name.trim() !== "" || r.note.trim() !== "";

export type PrescriptionAgeUnit = "years" | "months" | "days";

export interface PrescriptionDraft {
  labs?: PrescriptionRequestItem[];
  imaging?: PrescriptionRequestItem[];
  printLanguage?: PrescriptionLanguage;
  professional?: Partial<Record<PrescriptionLanguage, PrescriptionProfessional>>;
  /** الحساب الذي كتب المسودة — لا تُعرض لحساب آخر على نفس الجهاز. */
  ownerUserId: string;
  patient: PrescriptionPatient;
  /** الاسم المطبوع على الوصفة: يبدأ باسم المستفيد ويمكن للطبيب تعديله (للوصفة فقط، لا يغيّر بيانات المريض). */
  patientName: string;
  patientNameFr?: string;
  patientAge?: string;
  patientAgeUnit?: PrescriptionAgeUnit;
  medications: PrescriptionMedication[];
  notes: string;
  /** «current» = رُبطت تلقائيًا بالاستشارة الحالية، «manual» = اختارها الطبيب من موعد قائم. */
  source: "current" | "manual";
}

let seq = 0;
export function newMedication(directionsMode?: PrescriptionMedication["directionsMode"]): PrescriptionMedication {
  seq += 1;
  return { id: `med-${Date.now().toString(36)}-${seq}`, name: "", dose: "", frequency: "", duration: "", instructions: "", ...(directionsMode ? { directionsMode } : {}) };
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
  return { ownerUserId, patient, patientName: patient.bookedName, patientAge: "", patientAgeUnit: "years", medications: [newMedication("freeText")], notes: "", source };
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

export const filled = (m: PrescriptionMedication) => [m.name, m.quantity, m.dose, m.frequency, m.duration, m.instructions, m.strength, m.form, m.doseQty, m.doseUnit, m.doseCustom, m.freqKey, m.freqCustom, m.timingKey, m.durQty, m.durUnit, m.durCustom].some((v) => (v ?? "").trim() !== "");

/** يعيد دواءً محذوفًا بكل قيمه وفي ترتيبه الأصلي؛ إن كانت القائمة الحالية صفًا فارغًا واحدًا (بعد حذف الأخير) يحلّ محله. */
export function restoreMedication(list: PrescriptionMedication[], med: PrescriptionMedication, index: number): PrescriptionMedication[] {
  if (list.some((m) => m.id === med.id)) return list;
  if (list.length === 1 && !filled(list[0])) return [med];
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, med);
  return next;
}

/** هل كتب الطبيب شيئًا يُفقد؟ (تعديل الاسم وحده لا يُعدّ محتوى طبيًا لكنه يُحتسب كتعديل). */
export function draftHasContent(d: PrescriptionDraft | null | undefined): boolean {
  if (!d) return false;
  return d.medications.some(filled) || (d.labs ?? []).some(requestFilled) || (d.imaging ?? []).some(requestFilled) || d.notes.trim() !== "" || (d.patientNameFr ?? "").trim() !== "" || (d.patientAge ?? "").trim() !== "" || d.patientName.trim() !== d.patient.bookedName.trim()
    || Object.values(d.professional ?? {}).some(fields => Object.values(fields).some(value => Boolean(value?.trim())));
}

export interface DraftValidation {
  ok: boolean;
  errors: string[];
  medicationErrors: Record<string, Partial<Record<"name" | "dose" | "frequency" | "duration" | "instructions", string>>>;
  /** الأدوية التي ستُطبع فعلًا (الصفوف الفارغة كليًا تُتجاهل). */
  printable: PrescriptionMedication[];
  labs: PrescriptionRequestItem[];
  imaging: PrescriptionRequestItem[];
  requestErrors: Record<string, string>;
}

export function validateDraft(d: PrescriptionDraft): DraftValidation {
  const errors: string[] = [];
  const medicationErrors: DraftValidation["medicationErrors"] = {};
  if (!d.patientName.trim()) errors.push("اكتب اسم المريض.");
  if ((d.patientAge ?? "").trim() && prescriptionAgeValue(d.patientAge, d.patientAgeUnit) === null) errors.push("اكتب عمرًا صحيحًا للمريض أو اتركه فارغًا.");
  const rows = d.medications.filter(filled);
  const labs = (d.labs ?? []).filter(requestFilled).map(r => ({ ...r, name: r.name.trim(), note: r.note.trim() }));
  const imaging = (d.imaging ?? []).filter(requestFilled).map(r => ({ ...r, name: r.name.trim(), note: r.note.trim() }));
  const requestErrors: Record<string, string> = {};
  for (const [label, list] of [["التحاليل", labs], ["الأشعة والفحوصات", imaging]] as const) {
    list.forEach((r, i) => { if (!r.name) { requestErrors[r.id] = "اكتب اسم الطلب."; errors.push(`${label} رقم ${i + 1}: اكتب اسم الطلب.`); } });
  }
  // وصفة بتحاليل أو أشعة فقط مقبولة؛ لا يُشترط دواء إن وُجد طلب.
  if (rows.length === 0 && labs.length === 0 && imaging.length === 0) errors.push("أضف دواءً واحدًا على الأقل.");
  rows.forEach((m, i) => {
    const fields: DraftValidation["medicationErrors"][string] = {};
    if (!m.name.trim()) fields.name = "اسم الدواء مطلوب.";
    if (m.directionsMode === "freeText") {
      if (!m.instructions.trim()) fields.instructions = "اكتب تعليمات الاستخدام الكاملة لهذه الحالة.";
    } else {
      Object.assign(fields, structuredErrors(m));
    }
    if (Object.keys(fields).length) medicationErrors[m.id] = fields;
    Object.values(fields).forEach(message => errors.push(`الدواء رقم ${i + 1}: ${message}`));
  });
  return { ok: errors.length === 0, errors, medicationErrors, labs, imaging, requestErrors, printable: rows.map((m) => ({ ...m, name: m.name.trim() })) };
}

/** Compare immutable identifiers, never names. */
export function samePrescriptionVisit(p: PrescriptionPatient, a: Appointment): boolean {
  const next = prescriptionPatientFrom(a);
  return p.appointmentId === next.appointmentId && p.patientId === next.patientId && p.familyMemberId === next.familyMemberId;
}

export function prescriptionVisitLabel(p: PrescriptionPatient): string {
  return `${p.bookedName} — ${p.appointmentDate.slice(0, 10)} — ${p.startTime}`;
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

/** Age belongs to this prescription only; never infer it from the account holder. */
export function prescriptionAgeValue(value: string | undefined, unit: PrescriptionAgeUnit = "years"): number | null {
  const text = (value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const age = Number(text);
  const max = { years: 150, months: 1800, days: 55000 }[unit];
  return Number.isFinite(age) && age >= 0 && age <= max ? age : null;
}
