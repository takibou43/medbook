import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { Star } from "lucide-react";
import clsx from "clsx";

export function RatingStars({ value, size = 16, interactive = false, onChange }: { value: number; size?: number; interactive?: boolean; onChange?: (v: number) => void }) {
  useLanguage();
  if (!interactive) {
    return (
      <span className="inline-flex items-center gap-1" role="img" aria-label={String(value) + t(" من 5")}>
        <span aria-hidden="true" className="inline-flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} width={size} height={size} className={n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200"} />
          ))}
        </span>
        <span className="text-xs text-slate-600" aria-hidden="true">{value}{t(" من 5")}</span>
      </span>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          aria-label={t("{0} من 5", { "0": n })}
          type="button"
          disabled={!interactive}
          onClick={() => onChange?.(n)}
          className={clsx(!interactive && "cursor-default")}
        >
          <Star
            width={size}
            height={size}
            className={n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200"}
          />
        </button>
      ))}
    </div>
  );
}
