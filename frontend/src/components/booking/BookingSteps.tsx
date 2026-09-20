import { Check } from "lucide-react";
import clsx from "clsx";

export type StepId = "specialty" | "doctor" | "slot" | "patient" | "confirm";

export const BOOKING_STEPS: { id: StepId; label: string }[] = [
  { id: "specialty", label: "التخصص" },
  { id: "doctor", label: "الطبيب" },
  { id: "slot", label: "الموعد" },
  { id: "patient", label: "بيانات المريض" },
  { id: "confirm", label: "التأكيد" },
];

// شريط الخطوات: المرحلة الحالية لا تُميَّز باللون وحده — بل بالرقم داخل دائرة مؤطَّرة، والمكتملة بعلامة ✓،
// والقادمة بدائرة فارغة، مع نص مخفي للقارئات الشاشية يذكر حالة كل خطوة (aria-current="step" للحالية).
export function BookingSteps({ current }: { current: StepId }) {
  const currentIndex = BOOKING_STEPS.findIndex((s) => s.id === current);

  return (
    <nav aria-label="مراحل الحجز" className="mb-6">
      <ol className="flex items-start">
        {BOOKING_STEPS.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const isLast = i === BOOKING_STEPS.length - 1;
          return (
            <li key={step.id} className="relative flex flex-1 flex-col items-center gap-1.5" aria-current={active ? "step" : undefined}>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={clsx("absolute start-1/2 top-4 h-0.5 w-full", done ? "bg-primary-500" : "bg-slate-200")}
                />
              )}
              <span
                className={clsx(
                  "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition",
                  done && "border-primary-600 bg-primary-600 text-white",
                  active && "border-primary-600 bg-white text-primary-700 ring-4 ring-primary-100",
                  !done && !active && "border-slate-300 bg-white text-slate-400"
                )}
              >
                {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span
                className={clsx(
                  "text-center text-[11px] font-semibold leading-tight sm:text-xs",
                  active ? "text-primary-700" : done ? "text-slate-600" : "text-slate-400"
                )}
              >
                {step.label}
                <span className="sr-only">{done ? " (مكتملة)" : active ? " (المرحلة الحالية)" : " (قادمة)"}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
