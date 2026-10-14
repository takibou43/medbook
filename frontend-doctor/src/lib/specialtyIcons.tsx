import type { ReactNode } from "react";

// أيقونات التخصصات — SVG محلية مضمّنة في الحزمة (لا صور خارجية ولا طلبات شبكة إضافية).
// أسلوب موحّد: مساحة 48×48، خط بسمك 2.5 بأطراف مستديرة، تعبئة خفيفة من لون النص الحالي.
// لإضافة تخصص جديد: أضف مسارًا في ICONS، ثم (اختياريًا) كلمة مفتاحية عربية في NAME_RULES.

const FILL = { fill: "currentColor", fillOpacity: 0.16 } as const;

const ICONS: Record<string, ReactNode> = {
  // طب الأسنان — ضرس بجذرين
  tooth: (
    <path
      {...FILL}
      d="M24 11C21 9 18 8 15 8.5C10.5 9.3 8 13 8.5 17.5C9 22 11.5 24 12.5 29C13 34 13.5 40 16.5 40C19.5 40 19.5 33 21 30.5C22 29 26 29 27 30.5C28.5 33 28.5 40 31.5 40C34.5 40 35 34 35.5 29C36.5 24 39 22 39.5 17.5C40 13 37.5 9.3 33 8.5C30 8 27 9 24 11Z"
    />
  ),
  // طب القلب
  "heart-pulse": (
    <>
      <path {...FILL} d="M24 41C10 31 6 24 6 17.5C6 12 10 8.5 14.5 8.5C18.5 8.5 22 10.5 24 14C26 10.5 29.5 8.5 33.5 8.5C38 8.5 42 12 42 17.5C42 24 38 31 24 41Z" />
      <path fill="none" d="M10 24H18L21 18L26 31L29 24H38" />
    </>
  ),
  // طب العيون
  eye: (
    <>
      <path {...FILL} d="M4 24C9 14 16 10 24 10C32 10 39 14 44 24C39 34 32 38 24 38C16 38 9 34 4 24Z" />
      <circle cx="24" cy="24" r="7" fill="none" />
      <circle cx="24" cy="24" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  // طب الأطفال — وجه طفل بخصلة شعر
  baby: (
    <>
      <circle {...FILL} cx="24" cy="26" r="15" />
      <path fill="none" d="M24 11C21 7.5 24 4 27.5 6" />
      <circle cx="18" cy="26" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="30" cy="26" r="1.6" fill="currentColor" stroke="none" />
      <path fill="none" d="M20 32Q24 35.5 28 32" />
    </>
  ),
  // طب الأعصاب — دماغ (نصفان متماثلان)
  brain: (
    <>
      <g>
        <path {...FILL} d="M24 10C22 8 19 8 17 9C13 9 10 12.5 10.5 16.5C7 18.5 7 25 10 27.5C9 32 12 36.5 16.5 36.5C18 39.5 22 40 24 38Z" />
        <path fill="none" d="M24 18C21 18 19 19.5 18.5 22M24 29C21 29 19 30.5 18 33" />
      </g>
      <g transform="translate(48 0) scale(-1 1)">
        <path {...FILL} d="M24 10C22 8 19 8 17 9C13 9 10 12.5 10.5 16.5C7 18.5 7 25 10 27.5C9 32 12 36.5 16.5 36.5C18 39.5 22 40 24 38Z" />
        <path fill="none" d="M24 18C21 18 19 19.5 18.5 22M24 29C21 29 19 30.5 18 33" />
      </g>
    </>
  ),
  // الأنف والأذن والحنجرة — أذن
  ear: (
    <>
      <path {...FILL} d="M14 20C14 12 19 7 25 7C32 7 36 12 36 18C36 24 31 26 30 31C29 36 26 40 22 40C18 40 16 37 16 34" />
      <path fill="none" d="M22 20C22 16 27 15 28 19C29 22 25 24 24 27" />
    </>
  ),
  // طب عام — سمّاعة طبية
  stethoscope: (
    <>
      <path fill="none" d="M14 8V20C14 27 19 30 24 30C29 30 34 27 34 20V8" />
      <path fill="none" d="M24 30V33C24 38 28 40 32 40C36 40 38 36 38 32" />
      <circle {...FILL} cx="38" cy="28" r="4" />
      <circle cx="14" cy="8" r="2" fill="currentColor" stroke="none" />
      <circle cx="34" cy="8" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  // الأمراض الجلدية — قطرة مع لمعة
  sparkles: (
    <>
      <path {...FILL} d="M22 8C22 8 11 21 11 29C11 35.5 16 40 22 40C28 40 33 35.5 33 29C33 21 22 8 22 8Z" />
      <path d="M37 6L38.3 9.7L42 11L38.3 12.3L37 16L35.7 12.3L32 11L35.7 9.7Z" fill="currentColor" strokeWidth="1.5" />
    </>
  ),
  // جراحة عامة — مقص
  scissors: (
    <>
      <circle {...FILL} cx="14" cy="36" r="5" />
      <circle {...FILL} cx="34" cy="36" r="5" />
      <path fill="none" d="M17.5 32.5L38 8M30.5 32.5L10 8" />
    </>
  ),
  // طب النساء والتوليد — رمز الأنثى
  flower: (
    <>
      <circle {...FILL} cx="24" cy="18" r="11" />
      <path fill="none" d="M24 29V44M16 37H32" />
    </>
  ),
};

const DEFAULT_KEY = "stethoscope";

// كلمات مفتاحية عربية احتياطية إن لم يحمل التخصص مفتاح أيقونة معروفًا. الترتيب مهم:
// "جراحة عامة" يجب أن تُطابَق قبل الافتراضي العام.
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
  if (specialty.icon && ICONS[specialty.icon]) return specialty.icon;
  const name = specialty.nameAr ?? "";
  for (const [re, key] of NAME_RULES) if (re.test(name)) return key;
  return DEFAULT_KEY;
}

interface Props {
  specialty: { icon?: string | null; nameAr?: string | null };
  className?: string;
}

// أيقونة زخرفية فقط (aria-hidden) — اسم التخصص يبقى نصًا ظاهرًا في البطاقة.
export function SpecialtyIcon({ specialty, className = "h-9 w-9" }: Props) {
  const key = resolveSpecialtyIconKey(specialty);
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={key}
    >
      {ICONS[key]}
    </svg>
  );
}
