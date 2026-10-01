/**
 * هل هذا التخصص طب أسنان؟ — نقطة مركزية واحدة يستعملها كل ما يخص خطط علاج الأسنان.
 *
 * لا يوجد حاليًا في جدول specialties معرّف ثابت (slug/key) للتخصص، فقط nameAr (فريد) و nameFr.
 * لذلك نفحص الاسمين معًا بقواعد محافظة تغطي الأسماء الموجودة فعلًا ("طب الأسنان" / "Dentisterie" في seed)
 * وصيغها الشائعة، دون الاعتماد على اسم عربي واحد حرفيًا.
 *
 * ⚠️ حاجة مستقبلية: إضافة حقل ثابت مثل Specialty.key = "DENTISTRY" (لا يتغيّر بتعديل الاسم من لوحة الإدارة)
 * واستبدال هذا الفحص به. إلى ذلك الحين، تغيير اسم التخصص في لوحة الإدارة إلى صيغة لا تحتوي «أسنان»
 * ولا dent/stomato/odonto سيوقف الميزة لأطبائه.
 *
 * دالة نقية — لا قاعدة بيانات.
 */

// تطبيع عربي خفيف: إزالة التشكيل والتطويل وتوحيد الألف والهمزات حتى تتطابق «الأسنان» و«الاسنان».
function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/\s+/g, " ")
    .trim();
}

const AR_PATTERNS = [/اسنان/, /سنان/, /تقويم الاسنان/];
// dentisterie, dentiste, dental, dentistry, chirurgie dentaire, stomatologie, odontologie, orthodontie
const LATIN_PATTERN = /(dent|stomato|odonto|orthodont)/i;

export function isDentalSpecialty(specialty: { nameAr?: string | null; nameFr?: string | null } | null | undefined): boolean {
  if (!specialty) return false;
  const ar = normalizeArabic(specialty.nameAr ?? "");
  if (ar && AR_PATTERNS.some((p) => p.test(ar))) return true;
  const fr = (specialty.nameFr ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return LATIN_PATTERN.test(fr);
}

export const NOT_DENTAL_MESSAGE = "خطط علاج الأسنان متاحة لأطباء الأسنان فقط.";
