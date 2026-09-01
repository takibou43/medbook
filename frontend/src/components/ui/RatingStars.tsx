import { Star } from "lucide-react";
import clsx from "clsx";

export function RatingStars({ value, size = 16, interactive = false, onChange }: { value: number; size?: number; interactive?: boolean; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
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
