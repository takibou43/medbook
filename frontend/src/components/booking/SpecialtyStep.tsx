import { forwardRef } from "react";
import { Search } from "lucide-react";
import { EmptyState } from "../ui/States";
import { Specialty } from "../../types";
import { doctorsCountLabel, specialtyIcon } from "../../lib/booking";
import { StepHeading, InlineError } from "./StepParts";
import { SpecialtyGridSkeleton } from "./Skeletons";

export interface SpecialtyOption {
  specialty: Specialty;
  doctorsCount: number;
}

interface Props {
  options: SpecialtyOption[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSelect: (specialtyId: string) => void;
  onOpenSearch: () => void;
}

// الخطوة 1: "اختر التخصص". التخصصات وأعدادها مشتقّة من الأطباء الموثّقين الفعليين المعروضين للمريض
// (لا قائمة ثابتة ولا تخصصات وهمية) — فلا يظهر تخصص إلا إذا كان فيه طبيب حقيقي يستطيع المريض حجزه.
export const SpecialtyStep = forwardRef<HTMLHeadingElement, Props>(({ options, loading, error, onRetry, onSelect, onOpenSearch }, ref) => (
  <section aria-labelledby="step-specialty-title">
    <StepHeading ref={ref} id="step-specialty-title" hint="اختر التخصص الذي تحتاجه، ثم الطبيب المناسب.">
      اختر التخصص
    </StepHeading>

    {loading ? (
      <SpecialtyGridSkeleton />
    ) : error ? (
      <InlineError title="تعذّر تحميل التخصصات." message="تحقق من اتصالك بالإنترنت ثم أعد المحاولة." onRetry={onRetry} />
    ) : options.length === 0 ? (
      <EmptyState title="لا يوجد أطباء مسجلون حاليًا" description="سيُفتح الحجز فور اشتراك أطباء جدد." />
    ) : (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {options.map(({ specialty, doctorsCount }) => {
          const Icon = specialtyIcon(specialty.icon);
          return (
            <li key={specialty.id}>
              <button
                type="button"
                onClick={() => onSelect(specialty.id)}
                className="flex min-h-[8rem] w-full flex-col items-center justify-center gap-2 glass p-4 text-center transition hover:border-primary-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.98]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="text-sm font-bold leading-snug text-slate-800">{specialty.nameAr}</span>
                <span className="text-xs text-slate-500">{doctorsCountLabel(doctorsCount)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    )}

    {/* البحث بالاسم خيار ثانوي — المسار الأساسي هو التخصص ثم الطبيب. */}
    {!loading && !error && (
      <div className="mt-5 text-center">
        <button
          type="button"
          onClick={onOpenSearch}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-600 underline-offset-4 transition hover:text-primary-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          تبحث عن طبيب معين؟
        </button>
      </div>
    )}
  </section>
));
SpecialtyStep.displayName = "SpecialtyStep";
