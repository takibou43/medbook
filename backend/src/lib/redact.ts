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
