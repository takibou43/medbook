import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
import { forwardRef, useState } from "react";
import { Search } from "lucide-react";
import { DoctorSearchModal } from "./DoctorSearchModal";
import { EmptyState } from "../ui/States";
import { Doctor, Specialty } from "../../types";
import { doctorsCountLabel } from "../../lib/booking";
import { SpecialtyIcon } from "../../lib/specialtyIcons";
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
  // رسالة دقيقة حسب سبب الفشل (انقطاع/مهلة/429/5xx) — تُحسب في الصفحة عبر apiErrorMessage.
  errorMessage?: string;
  onRetry: () => void;
  onSelect: (specialtyId: string) => void;
  onDoctorSelect: (doctor: Doctor) => void;
}

// الخطوة 1: "اختر التخصص". التخصصات وأعدادها مشتقّة من الأطباء الموثّقين الفعليين المعروضين للمريض
// (لا قائمة ثابتة ولا تخصصات وهمية) — فلا يظهر تخصص إلا إذا كان فيه طبيب حقيقي يستطيع المريض حجزه.
export const SpecialtyStep = forwardRef<HTMLHeadingElement, Props>(({ options, loading, error, errorMessage, onRetry, onSelect, onDoctorSelect }, ref) => {
  useLanguage();
  const [searchOpen, setSearchOpen] = useState(false);
  return (
  <section aria-labelledby="step-specialty-title">
    <div className="flex items-start justify-between gap-3">
      <StepHeading ref={ref} id="step-specialty-title" hint={t("اختر التخصص الذي تحتاجه، ثم الطبيب المناسب.")}>{t("اختر التخصص ")}</StepHeading>
      <button type="button" aria-label={t("ابحث عن طبيب بالاسم")} title={t("ابحث عن طبيب بالاسم")} aria-haspopup="dialog" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)} className="glass-control flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary-200 bg-white text-primary-700 shadow-sm transition hover:bg-white/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
    {searchOpen && <DoctorSearchModal onClose={() => setSearchOpen(false)} onSelect={doctor => { setSearchOpen(false); onDoctorSelect(doctor); }} />}

    {loading ? (
      <SpecialtyGridSkeleton />
    ) : error ? (
      <InlineError title={t("تعذّر تحميل التخصصات.")} message={errorMessage ?? t("أعد المحاولة بعد قليل.")} onRetry={onRetry} />
    ) : options.length === 0 ? (
      <EmptyState title={t("لا يوجد أطباء مسجلون حاليًا")} description={t("سيُفتح الحجز فور اشتراك أطباء جدد.")} />
    ) : (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {options.map(({ specialty, doctorsCount }) => {
          return (
            <li key={specialty.id}>
              <button
                type="button"
                onClick={() => onSelect(specialty.id)}
                className="flex min-h-[8rem] w-full flex-col items-center justify-center gap-2 glass p-4 text-center transition-colors hover:border-primary-400 hover:bg-white/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:bg-primary-100"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                  <SpecialtyIcon specialty={specialty} />
                </span>
                <span className="text-sm font-bold leading-snug text-slate-800">{catalogName(specialty)}</span>
                <span className="text-xs text-slate-500">{doctorsCountLabel(doctorsCount)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    )}

  </section>
); });
SpecialtyStep.displayName = "SpecialtyStep";
