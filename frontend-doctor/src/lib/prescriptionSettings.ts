import type { PrescriptionLanguage, PrescriptionProfessional } from "./prescriptionPrint.ts";

/** إعدادات الوصفة المحفوظة في حساب الطبيب (تُطبَّق تلقائيًا على كل وصفة جديدة). */
export interface PrescriptionShow { clinicName: boolean; address: boolean; phone: boolean; specialty: boolean }
export interface PrescriptionSettings {
  language: PrescriptionLanguage;
  professional: Partial<Record<PrescriptionLanguage, PrescriptionProfessional>>;
  show: PrescriptionShow;
}

export const DEFAULT_PRESCRIPTION_SETTINGS: PrescriptionSettings = {
  language: "ar",
  professional: {},
  show: { clinicName: true, address: true, phone: true, specialty: true },
};

/** يدمج ما جاء من الخادم مع الافتراضيات دون أن يفقد حقلًا ناقصًا (إعدادات قديمة أو فارغة). */
export function normalizeSettings(raw: unknown): PrescriptionSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PrescriptionSettings>;
  const clean = (p: PrescriptionProfessional | undefined): PrescriptionProfessional => ({
    ...(typeof p?.doctorName === "string" ? { doctorName: p.doctorName } : {}),
    ...(typeof p?.clinicName === "string" ? { clinicName: p.clinicName } : {}),
    ...(typeof p?.address === "string" ? { address: p.address } : {}),
  });
  return {
    language: r.language === "fr" ? "fr" : "ar",
    professional: { ar: clean(r.professional?.ar), fr: clean(r.professional?.fr) },
    show: { ...DEFAULT_PRESCRIPTION_SETTINGS.show, ...Object.fromEntries(Object.entries(r.show ?? {}).filter(([, v]) => typeof v === "boolean")) },
  };
}

/** الحمولة التي تُرسل للخادم: نصوص مقصوصة وفارغها يُحذف، والأعلام كما هي. */
export function settingsPayload(s: PrescriptionSettings) {
  const pro = (p: PrescriptionProfessional | undefined) => Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, (v ?? "").trim()]).filter(([, v]) => v));
  return { language: s.language, professional: { ar: pro(s.professional.ar), fr: pro(s.professional.fr) }, show: s.show };
}

export function sameSettings(a: PrescriptionSettings, b: PrescriptionSettings): boolean {
  return JSON.stringify(settingsPayload(a)) === JSON.stringify(settingsPayload(b));
}
