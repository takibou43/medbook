import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLanguage } from "../../i18n/locale.ts";
import { useId, useRef } from "react";
import { CalendarDays, X } from "lucide-react";
import clsx from "clsx";
import { formatDayAr } from "../../lib/doctorUi";

/**
 * حقل تاريخ بصيغة عربية موحّدة. حقل التاريخ الأصلي في المتصفح يعرض صيغة لغة الجهاز
 * (مثل jj/mm/aaaa على الأجهزة الفرنسية)، فنُبقيه فوق النص العربي شفافًا: النقر يفتح منتقي
 * التاريخ الأصلي (قابل للوصول ولوحة المفاتيح تعمل عليه كالعادة)، والنص الظاهر عربي.
 */
export function DateField({
  label,
  value,
  onChange,
  placeholder = t("اختر تاريخًا"),
  min,
  max,
  className,
  hideLabel,
  clearable = true,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  className?: string;
  hideLabel?: boolean;
  clearable?: boolean;
}) {
  useLanguage();
  const id = `d${useId().replace(/:/g, "")}`;
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "label"}>
        {t(label ?? "")}
      </label>
      <div className="relative rounded-xl border border-slate-300 bg-white transition focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100">
        <div aria-hidden="true" className="pointer-events-none flex min-h-[42px] items-center gap-2 px-3.5 py-2 text-sm">
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" />
          <span className={clsx("truncate", value ? "font-semibold text-slate-800" : "text-slate-500")}>
            {value ? formatDayAr(value) : placeholder}
          </span>
        </div>
        <input
          ref={ref}
          id={id}
          type="date"
          lang={getLanguage()}
          value={value ?? ""}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value || undefined)}
          onClick={() => {
            try {
              ref.current?.showPicker?.();
            } catch {
              /* بعض المتصفحات لا تدعم showPicker — النقر العادي يكفي */
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-description={value ? formatDayAr(value) : undefined}
        />
        {clearable && value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="absolute end-1.5 top-1/2 z-10 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label={t("مسح {0}", { "0": label })}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
