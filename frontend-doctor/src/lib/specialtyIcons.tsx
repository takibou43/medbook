import stethoscope from "../assets/specialty-icons/stethoscope.svg?raw";
import tooth from "../assets/specialty-icons/tooth.svg?raw";
import eye from "../assets/specialty-icons/eye.svg?raw";
import pediatrics from "../assets/specialty-icons/pediatrics.svg?raw";
import neurology from "../assets/specialty-icons/neurology.svg?raw";
import cardiology from "../assets/specialty-icons/cardiology.svg?raw";
import earNoseThroat from "../assets/specialty-icons/ear-nose-throat.svg?raw";
import gynecology from "../assets/specialty-icons/gynecology.svg?raw";
import generalSurgery from "../assets/specialty-icons/general-surgery.svg?raw";
import tissue from "../assets/specialty-icons/tissue.svg?raw";

// أيقونات Health Icons محلية، SVG شفافة وملائمة للطباعة؛ لا تُحمّل صورًا وقت التشغيل.
// ملفات الأيقونات من المشروع الرسمي تحت CC0-1.0: docs/healthicons-CC0-LICENSE.txt.
const ICONS: Record<string, string> = {
  stethoscope,
  tooth,
  eye,
  baby: pediatrics,
  brain: neurology,
  "heart-pulse": cardiology,
  ear: earNoseThroat,
  flower: gynecology,
  scissors: generalSurgery,
  sparkles: tissue,
};

// الأيقونات الأصلية بيانات ثابتة داخل الحزمة؛ نعرض محتواها داخل SVG كي ترث لون التخصص
// وتبقى متجهية في المعاينة والطباعة. لا تدخل أي بيانات من المستخدم في هذا المحتوى.
const INNER: Record<string, string> = Object.fromEntries(
  Object.entries(ICONS).map(([key, svg]) => [key, svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")]),
);

const DEFAULT_KEY = "stethoscope";

const NAME_RULES: Array<[RegExp, string]> = [
  [/أسنان|اسنان|(^|\s)سن(\s|$)/, "tooth"],
  [/جلد/, "sparkles"],
  [/أنف|انف|أذن|اذن|حنجرة/, "ear"],
  [/جراح/, "scissors"],
  [/أطفال|اطفال/, "baby"],
  [/أعصاب|اعصاب|دماغ|مخ/, "brain"],
  [/عيون|عين|رمد/, "eye"],
  [/قلب/, "heart-pulse"],
  [/نساء|توليد/, "flower"],
];

export function resolveSpecialtyIconKey(specialty: { icon?: string | null; nameAr?: string | null }): string {
  if (specialty.icon && INNER[specialty.icon]) return specialty.icon;
  const name = specialty.nameAr ?? "";
  for (const [re, key] of NAME_RULES) if (re.test(name)) return key;
  return DEFAULT_KEY;
}

interface Props {
  specialty: { icon?: string | null; nameAr?: string | null };
  className?: string;
}

export function SpecialtyIcon({ specialty, className = "h-9 w-9" }: Props) {
  const key = resolveSpecialtyIconKey(specialty);
  return <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false" data-icon={key} dangerouslySetInnerHTML={{ __html: INNER[key] ?? INNER[DEFAULT_KEY] }} />;
}
