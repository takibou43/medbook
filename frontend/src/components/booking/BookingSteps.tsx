import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import clsx from "clsx";

export type StepId = "specialty" | "doctor" | "slot" | "patient" | "confirm";

export const BOOKING_STEPS: { id: StepId; label: string }[] = [
  { id: "specialty", label: "التخصص" },
  { id: "doctor", label: "الطبيب" },
  { id: "slot", label: "الموعد" },
  { id: "patient", label: "بيانات المريض" },
  { id: "confirm", label: "التأكيد" },
];

// Compact visible progress, with the full ordered sequence retained for screen readers.
export function BookingSteps({ current }: { current: StepId }) {
  useLanguage();
  const currentIndex = BOOKING_STEPS.findIndex((s) => s.id === current);

  return (
    <nav aria-label={t("مراحل الحجز")} className="glass mb-4 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
        <span className="flex items-center gap-2 font-bold text-primary-800" aria-current="step">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs text-white" aria-hidden="true">{currentIndex + 1}</span>
          {t(BOOKING_STEPS[currentIndex].label)}
        </span>
        <span className="shrink-0 text-slate-600">{t("الخطوة {0} من {1}", { "0": currentIndex + 1, "1": BOOKING_STEPS.length })}</span>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {BOOKING_STEPS.map((step, i) => <span key={step.id} className={clsx("h-1 flex-1 rounded-full", i <= currentIndex ? "bg-primary-600" : "bg-slate-200")} />)}
      </div>
      <ol className="sr-only">
        {BOOKING_STEPS.map((step, i) => <li key={step.id} aria-current={i === currentIndex ? "step" : undefined}>
          {t(step.label)}{i < currentIndex ? t(" (مكتملة)") : i === currentIndex ? t(" (المرحلة الحالية)") : t(" (قادمة)")}
        </li>)}
      </ol>
    </nav>
  );
}
