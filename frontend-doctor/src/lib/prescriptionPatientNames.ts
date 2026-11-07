import type { PrescriptionPatient } from "./prescription.ts";
const STORAGE_PREFIX = "medbook-prescription-latin-names-v1:";
const storageKey = (owner: string) => `${STORAGE_PREFIX}${owner}`;
const patientKey = (patient: PrescriptionPatient) => patient.familyMemberId ? `family:${patient.familyMemberId}` : patient.patientId ? `patient:${patient.patientId}` : `visit:${patient.appointmentId}`;
type Entry = { original: string; name: string; savedAt: number };
// حواسيب العيادات مشتركة غالبًا: الأسماء اللاتينية للمرضى لا تبقى أكثر من أسبوع، وتُمسح كلها عند الخروج.
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function validLatinPatientName(value: string): boolean {
  return value.trim().length > 0 && value.trim().length <= 160 && /\p{Script=Latin}/u.test(value) && /^[\p{Script=Latin}\p{M} .'’\-]+$/u.test(value.trim());
}
function read(owner: string): Record<string, Entry> {
  if (!owner) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(owner)) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => {
      const e = v as Entry;
      return e && typeof e.original === "string" && typeof e.name === "string" && validLatinPatientName(e.name) && typeof e.savedAt === "number" && e.savedAt <= Date.now() && Date.now() - e.savedAt < MAX_AGE;
    })) as Record<string, Entry>;
  } catch { return {}; }
}
export function readPatientLatinName(owner: string, patient: PrescriptionPatient): string {
  const entry = read(owner)[patientKey(patient)];
  return entry?.original === patient.bookedName ? entry.name : "";
}
export function rememberPatientLatinName(owner: string, patient: PrescriptionPatient, name: string): boolean {
  if (!owner || !validLatinPatientName(name)) return false;
  const entries = { ...read(owner), [patientKey(patient)]: { original: patient.bookedName, name: name.trim(), savedAt: Date.now() } };
  const bounded = Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 200));
  try { localStorage.setItem(storageKey(owner), JSON.stringify(bounded)); return true; } catch { return false; }
}
export function forgetPatientLatinName(owner: string, patient: PrescriptionPatient): boolean {
  const entries = read(owner); delete entries[patientKey(patient)];
  try { localStorage.setItem(storageKey(owner), JSON.stringify(entries)); return true; } catch { return false; }
}

/** يمسح كل الأسماء المحفوظة لكل الحسابات على هذا المتصفح (يُستدعى عند تسجيل الخروج). */
export function clearAllPatientLatinNames(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* التخزين قد يكون ممنوعًا في التصفح الخاص */ }
}
