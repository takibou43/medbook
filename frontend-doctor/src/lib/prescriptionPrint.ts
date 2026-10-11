/** Print language is explicit and independent of the dashboard language. */
export type PrescriptionLanguage = "ar" | "fr";
export interface PrescriptionProfessional {
  doctorName?: string;
  clinicName?: string;
  address?: string;
}

const labels = {
  ar: { sheet: "الوصفة الطبية", doctor: "د.", phone: "الهاتف:", title: "وصفة طبية", patient: "المريض", date: "التاريخ", medications: "الأدوية", labs: "التحاليل المطلوبة", imaging: "الأشعة والفحوصات", dose: "الجرعة", frequency: "التكرار", duration: "المدة", instructions: "تعليمات:", notes: "ملاحظات", signature: "توقيع الطبيب", stamp: "الختم" },
  fr: { sheet: "Ordonnance médicale", doctor: "Dr", phone: "Téléphone :", title: "Ordonnance médicale", patient: "Patient", date: "Date", medications: "Médicaments", labs: "Analyses demandées", imaging: "Imagerie et examens", dose: "Dose", frequency: "Fréquence", duration: "Durée", instructions: "Instructions :", notes: "Remarques", signature: "Signature du médecin", stamp: "Cachet" },
};

export function prescriptionLabels(language: PrescriptionLanguage) { return labels[language]; }

export function prescriptionDate(day: string, language: PrescriptionLanguage): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return "";
  return new Intl.DateTimeFormat(language === "fr" ? "fr-DZ" : "ar-DZ", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Algiers",
  }).format(date);
}

/** Missing French text falls back to the approved original, without guessing. */
export function prescriptionCatalogName(item: { nameAr: string; nameFr?: string | null } | null | undefined, language: PrescriptionLanguage): string {
  return (language === "fr" ? item?.nameFr?.trim() || item?.nameAr : item?.nameAr) ?? "";
}

export function professionalText(override: string | undefined, original: string | null | undefined): string {
  return override?.trim() || original?.trim() || "";
}

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const AR_PREFIX = /^\s*(?:(?:الدكتورة|الدكتور|دكتورة|دكتور)(?=[\s.:/\-]|$)|د\s*[./]|د(?=\s))[\s.:/\-]*/;
const FR_PREFIX = /^\s*(?:docteur|doctor|dr)(?![\p{L}\p{N}])[\s.:/\-]*/iu;

/** يزيل بادئة «د.»/«Dr» إن كتبها الطبيب داخل الاسم حتى لا تتكرر مع بادئة الورقة. */
export function stripDoctorPrefix(name: string, language: PrescriptionLanguage): string {
  return name.replace(language === "ar" ? AR_PREFIX : FR_PREFIX, "").trim();
}

/**
 * اسم الطبيب لجهة واحدة من الترويسة (ar = يمين، fr = يسار).
 * الحقل اليدوي لتلك الجهة له الأولوية؛ وإلا يُستعمل اسم الحساب الأصلي فقط إن كانت كتابته
 * من نفس جهة الورقة (حروف عربية لليمين، غير عربية لليسار). لا ترجمة ولا نقل حرفي ولا اختلاق.
 */
export function doctorHeaderName(manual: string | undefined, accountName: string | null | undefined, side: PrescriptionLanguage): string {
  const typed = stripDoctorPrefix(manual?.trim() ?? "", side);
  if (typed) return typed;
  const original = stripDoctorPrefix(accountName?.trim() ?? "", side);
  if (!original) return "";
  return ARABIC_SCRIPT.test(original) === (side === "ar") ? original : "";
}

/** اسم العيادة لجهة واحدة: الحقل اليدوي أولًا، ثم الاسم الأصلي فقط إن طابق خط الجهة؛ بلا ترجمة ولا اختلاق. */
export function clinicHeaderName(manual: string | undefined, original: string | null | undefined, side: PrescriptionLanguage): string {
  const typed = manual?.trim() ?? "";
  if (typed) return typed;
  const base = original?.trim() ?? "";
  if (!base) return "";
  return ARABIC_SCRIPT.test(base) === (side === "ar") ? base : "";
}
