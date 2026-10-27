const iconUrl = (name: string) => `${import.meta.env.BASE_URL}specialty-icons/${name}.svg`;

// ملفات SVG محلية مستقلة لتبقى خفيفة الحزمة الأولية، وتُخدّم كأصول ثابتة عند الحاجة.
const ICONS: Record<string, string> = {
  stethoscope: iconUrl("stethoscope"),
  tooth: iconUrl("tooth"),
  eye: iconUrl("eye"),
  baby: iconUrl("pediatrics"),
  brain: iconUrl("neurology"),
  "heart-pulse": iconUrl("cardiology"),
  ear: iconUrl("ear-nose-throat"),
  flower: iconUrl("gynecology"),
  scissors: iconUrl("general-surgery"),
  sparkles: iconUrl("tissue"),
};

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
  if (specialty.icon && ICONS[specialty.icon]) return specialty.icon;
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
  return <img src={ICONS[key] ?? ICONS[DEFAULT_KEY]} className={className} alt="" aria-hidden="true" data-icon={key} />;
}
