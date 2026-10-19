import { PUBLIC_DOCTOR_SELECT } from './publicDoctorSelect';

/**
 * يحذف كود إحالة الطبيب (Doctor.referralCode) من أي رد يحمل كائن طبيب كاملًا (include: { doctor: true }).
 * الكود يخص الطبيب وحده (يشاركه بنفسه مع زملائه)؛ لا يجوز أن يظهر للمرضى في ردود الحجز/المفضلة.
 * يمرّ على الكائنات العادية والمصفوفات فقط (لا يلمس Date ولا غيرها)، ويعيد نسخة دون تعديل الأصل.
 */
const HIDDEN_KEYS = new Set(["referralCode"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function redactDoctorSecrets<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((v) => redactDoctorSecrets(v, depth + 1)) as unknown as T;
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(k)) continue;
    out[k] = redactDoctorSecrets(v, depth + 1);
  }
  return out as T;
}

type Selection = { [key: string]: boolean | { select: Selection } };
const clinicSelect: Selection = { id: true, nameAr: true, address: true, phone: true, photoUrl: true, description: true,
  city: { select: { id: true, nameAr: true } }, wilaya: { select: { id: true, nameAr: true, nameFr: true } } };
const { clinicTerms: _terms, ...publicDoctorSelect } = PUBLIC_DOCTOR_SELECT;

function pickPublic(value: unknown, selection: Selection): unknown {
  if (Array.isArray(value)) return value.map(item => pickPublic(item, selection));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(selection)) {
    if (!(key in value) || !spec) continue;
    out[key] = spec === true ? value[key] : pickPublic(value[key], spec.select);
  }
  return out;
}

/** Patient-only output projection. Appointment and beneficiary IDs and saved prices stay intact. */
export function redactPatientResponse<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => redactPatientResponse(item)) as T;
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(key)) continue;
    out[key] = key === 'doctor' ? pickPublic(item, publicDoctorSelect as Selection)
      : key === 'clinic' ? pickPublic(item, clinicSelect) : redactPatientResponse(item);
  }
  return out as T;
}

export function redactForRole<T>(value: T, role: string): T {
  return role === 'PATIENT' ? redactPatientResponse(value) : redactDoctorSecrets(value);
}
