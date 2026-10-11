import type { PrescriptionMedication } from "./prescription.ts";
import type { PrescriptionLanguage } from "./prescriptionPrint.ts";

/**
 * تنسيق الدواء المشترك بين نموذج الإدخال والمعاينة والطباعة.
 * لا افتراضات طبية: لا جرعة ولا وحدة ولا مدة تُملأ من تلقاء النظام؛ القوائم أدناه خيارات فقط يختارها الطبيب.
 * القيم النصية القديمة (dose/frequency/duration) تُعرض كما كُتبت ولا تُحوَّل إلى حقول منظمة بالتخمين.
 */

type Lang = PrescriptionLanguage;
interface Option { key: string; ar: string; fr: string; frPlural?: string }

export const DOSE_UNITS: Option[] = [
  { key: "tablet", ar: "قرص", fr: "comprimé", frPlural: "comprimés" },
  { key: "capsule", ar: "كبسولة", fr: "gélule", frPlural: "gélules" },
  { key: "ml", ar: "مل", fr: "ml" },
  { key: "mg", ar: "ملغ", fr: "mg" },
  { key: "g", ar: "غ", fr: "g" },
  { key: "drop", ar: "قطرة", fr: "goutte", frPlural: "gouttes" },
  { key: "spoon", ar: "ملعقة", fr: "cuillère", frPlural: "cuillères" },
  { key: "sachet", ar: "كيس", fr: "sachet", frPlural: "sachets" },
  { key: "puff", ar: "بخة", fr: "bouffée", frPlural: "bouffées" },
  { key: "suppository", ar: "تحميلة", fr: "suppositoire", frPlural: "suppositoires" },
  { key: "ampoule", ar: "أمبولة", fr: "ampoule", frPlural: "ampoules" },
  { key: "application", ar: "وضعة", fr: "application", frPlural: "applications" },
];
export const FREQUENCIES: Option[] = [
  { key: "once", ar: "مرة واحدة يوميًا", fr: "1 fois par jour" },
  { key: "twice", ar: "مرتان يوميًا", fr: "2 fois par jour" },
  { key: "three", ar: "3 مرات يوميًا", fr: "3 fois par jour" },
  { key: "four", ar: "4 مرات يوميًا", fr: "4 fois par jour" },
  { key: "asNeeded", ar: "عند اللزوم", fr: "si besoin" },
];
export const TIMINGS: Option[] = [
  { key: "morning", ar: "صباحًا", fr: "le matin" },
  { key: "noon", ar: "ظهرًا", fr: "à midi" },
  { key: "evening", ar: "مساءً", fr: "le soir" },
  { key: "bedtime", ar: "عند النوم", fr: "au coucher" },
  { key: "beforeMeal", ar: "قبل الطعام", fr: "avant les repas" },
  { key: "withMeal", ar: "مع الطعام", fr: "pendant les repas" },
  { key: "afterMeal", ar: "بعد الطعام", fr: "après les repas" },
];
export const DURATION_UNITS = [
  { key: "day", ar: ["يوم", "يومان", "أيام", "يومًا"], fr: ["jour", "jours"] },
  { key: "week", ar: ["أسبوع", "أسبوعان", "أسابيع", "أسبوعًا"], fr: ["semaine", "semaines"] },
  { key: "month", ar: ["شهر", "شهران", "أشهر", "شهرًا"], fr: ["mois", "mois"] },
] as const;
export const CUSTOM = "custom";

const clean = (v: string | undefined | null) => (v ?? "").trim();
const join = (...parts: (string | undefined | null)[]) => parts.map(clean).filter(Boolean).join(" ");
const toNumber = (q: string) => { const n = Number(clean(q).replace(",", ".")); return Number.isFinite(n) && clean(q) !== "" ? n : null; };

/** هل استخدم الطبيب الحقول المنظمة؟ وإلا تُعرض القيمة القديمة كما هي. */
const hasDoseFields = (m: PrescriptionMedication) => Boolean(clean(m.doseQty) || clean(m.doseUnit) || clean(m.doseCustom));
const hasFreqFields = (m: PrescriptionMedication) => Boolean(clean(m.freqKey) || clean(m.freqCustom));
const hasDurFields = (m: PrescriptionMedication) => Boolean(clean(m.durQty) || clean(m.durUnit) || clean(m.durCustom));

export function doseText(m: PrescriptionMedication, lang: Lang): string {
  if (!hasDoseFields(m)) return clean(m.dose);
  const unit = DOSE_UNITS.find((u) => u.key === m.doseUnit);
  if (unit) {
    const n = toNumber(m.doseQty ?? "");
    const label = lang === "fr" ? (n !== null && n >= 2 && unit.frPlural ? unit.frPlural : unit.fr) : unit.ar;
    return join(m.doseQty, label);
  }
  return join(m.doseQty, m.doseCustom); // «مخصص» أو كمية بلا وحدة (يمنعها التحقق)
}

export function frequencyText(m: PrescriptionMedication, lang: Lang): string {
  if (!hasFreqFields(m)) return clean(m.frequency);
  const f = FREQUENCIES.find((o) => o.key === m.freqKey);
  return f ? f[lang] : clean(m.freqCustom);
}

export function timingText(m: PrescriptionMedication, lang: Lang): string {
  const t = TIMINGS.find((o) => o.key === m.timingKey);
  return t ? t[lang] : m.timingKey === CUSTOM ? clean(m.timingCustom) : "";
}

function durationUnitLabel(key: string, n: number | null, lang: Lang): string | null {
  const u = DURATION_UNITS.find((x) => x.key === key);
  if (!u) return null;
  if (lang === "fr") return n !== null && n >= 2 ? u.fr[1] : u.fr[0];
  if (n === null || !Number.isInteger(n) || n < 1) return u.ar[0];
  if (n === 1) return u.ar[0];
  if (n === 2) return u.ar[1];
  return n <= 10 ? u.ar[2] : u.ar[3];
}

export function durationText(m: PrescriptionMedication, lang: Lang): string {
  if (!hasDurFields(m)) return clean(m.duration);
  const label = durationUnitLabel(m.durUnit ?? "", toNumber(m.durQty ?? ""), lang);
  if (label) return join(m.durQty, label);
  return join(m.durQty, m.durCustom);
}

export interface MedicationParts {
  name: string;
  /** التركيز والشكل الدوائي إن كُتبا. */
  detail: string;
  /** الجرعة والتكرار والتوقيت والمدة — فارغة في نمط التعليمات الحرة. */
  facts: string[];
  instructions: string;
}

/** المصدر الوحيد لما يُعرض في الملخص والمعاينة والطباعة. لا يُنتج عناوين فارغة ولا undefined. */
export function medicationParts(m: PrescriptionMedication, lang: Lang): MedicationParts {
  const free = m.directionsMode === "freeText";
  const facts = free ? [] : [doseText(m, lang), frequencyText(m, lang), timingText(m, lang), durationText(m, lang)].filter(Boolean);
  return { name: clean(m.name), detail: join(m.strength, m.form), facts, instructions: clean(m.instructions) };
}

/**
 * يلصق الرقم بالكلمة التي تليه (مسافة غير قابلة للكسر) حتى لا تنفصل «jours» أو «أيام» أو «comprimés» عن عددها عند الالتفاف.
 * تغيير في نوع المسافة فقط: لا حروف تُضاف ولا تُحذف، وبقية المسافات تبقى قابلة للالتفاف (فتلتف التعليمات الطويلة كالمعتاد).
 */
export const glueNumberUnit = (text: string): string => text.replace(/(\p{Nd})[ \t]+(?=[^\s\p{Nd}])/gu, "$1\u00A0");

export function medicationSummary(m: PrescriptionMedication, lang: Lang): string {
  const p = medicationParts(m, lang);
  return [join(p.name, p.detail), ...p.facts, p.instructions].filter(Boolean).join(" — ");
}

export const medicationHasStructuredValues = (m: PrescriptionMedication) =>
  [m.dose, m.frequency, m.duration, m.doseQty, m.doseUnit, m.doseCustom, m.freqKey, m.freqCustom, m.timingKey, m.durQty, m.durUnit, m.durCustom].some((v) => clean(v));

/** أخطاء الحقول المنظمة بصياغة مفهومة؛ بلا قواعد طبية. */
export function structuredErrors(m: PrescriptionMedication): Partial<Record<"dose" | "frequency" | "duration", string>> {
  const e: Partial<Record<"dose" | "frequency" | "duration", string>> = {};
  if (!doseText(m, "ar")) e.dose = "اكتب كمية الجرعة واختر الوحدة.";
  else if (hasDoseFields(m) && clean(m.doseQty) && !clean(m.doseUnit)) e.dose = "اختر وحدة الجرعة أو اختر «أخرى» واكتبها.";
  else if (hasDoseFields(m) && m.doseUnit === CUSTOM && !clean(m.doseCustom) && !clean(m.doseQty)) e.dose = "اكتب الجرعة.";
  if (!frequencyText(m, "ar")) e.frequency = "اختر عدد مرات الاستخدام أو اكتبه.";
  if (!durationText(m, "ar")) e.duration = "اكتب مدة العلاج أو اختر «أخرى» واكتب شرط انتهائها.";
  else if (hasDurFields(m) && clean(m.durQty) && !clean(m.durUnit)) e.duration = "اختر وحدة المدة (أيام، أسابيع…) أو «أخرى».";
  return e;
}

/** دواء مكتمل = يمكن طيّه إلى ملخص. الدواء الجاري إدخاله يبقى مفتوحًا. */
export function medicationComplete(m: PrescriptionMedication): boolean {
  if (!clean(m.name)) return false;
  return m.directionsMode === "freeText" ? Boolean(clean(m.instructions)) : Object.keys(structuredErrors(m)).length === 0;
}

/** القيم الفعلية للحقول في الواجهة: النص القديم يظهر في خانة «أخرى» كما كُتب دون تحويله بالتخمين. */
export function editableValues(m: PrescriptionMedication) {
  return {
    doseQty: m.doseQty ?? "",
    doseUnit: hasDoseFields(m) ? clean(m.doseUnit) : clean(m.dose) ? CUSTOM : "",
    doseCustom: hasDoseFields(m) ? m.doseCustom ?? "" : m.dose,
    freqKey: hasFreqFields(m) ? clean(m.freqKey) : clean(m.frequency) ? CUSTOM : "",
    freqCustom: hasFreqFields(m) ? m.freqCustom ?? "" : m.frequency,
    timingKey: clean(m.timingKey),
    timingCustom: m.timingCustom ?? "",
    durQty: m.durQty ?? "",
    durUnit: hasDurFields(m) ? clean(m.durUnit) : clean(m.duration) ? CUSTOM : "",
    durCustom: hasDurFields(m) ? m.durCustom ?? "" : m.duration,
  };
}
