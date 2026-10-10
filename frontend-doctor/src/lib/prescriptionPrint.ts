/** Print language is explicit and independent of the dashboard language. */
export type PrescriptionLanguage = "ar" | "fr";
export interface PrescriptionProfessional {
  doctorName?: string;
  clinicName?: string;
  address?: string;
}

const labels = {
  ar: { sheet: "الوصفة الطبية", doctor: "د.", phone: "الهاتف:", title: "وصفة طبية", patient: "المريض", date: "التاريخ", medications: "الأدوية", dose: "الجرعة", frequency: "التكرار", duration: "المدة", instructions: "تعليمات:", notes: "ملاحظات", signature: "توقيع الطبيب", stamp: "الختم" },
  fr: { sheet: "Ordonnance médicale", doctor: "Dr", phone: "Téléphone :", title: "Ordonnance médicale", patient: "Patient", date: "Date", medications: "Médicaments", dose: "Dose", frequency: "Fréquence", duration: "Durée", instructions: "Instructions :", notes: "Remarques", signature: "Signature du médecin", stamp: "Cachet" },
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
