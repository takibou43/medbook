import { forwardRef, ReactNode } from "react";
import { ArrowLeft, CalendarDays, Clock, MapPin, Stethoscope } from "lucide-react";
import { Doctor, NextSlot } from "../../types";
import { doctorAddress, formatLongDate } from "../../lib/booking";
import { StepHeading, BackButton, InlineError } from "./StepParts";
import { SlotSkeleton } from "./Skeletons";

interface Props {
  doctor: Doctor;
  slot?: NextSlot;
  loading: boolean;
  // نوع الخطأ يحدّد الرسالة: لا أدوار متاحة (409) ≠ عطل شبكة/خادم.
  errorKind: "none" | "noSlots" | "failed";
  errorMessage?: string;
  onRetry: () => void;
  onContinue: () => void;
  onBack: () => void;
  backLabel: string;
  // اختيار اختياري لليوم/الوقت: إن وُجد يحلّ محل «أقرب موعد» المعروض. picker = مكوّن الاختيار نفسه.
  choice?: { date: string; startTime: string | null } | null;
  picker?: ReactNode;
}

// الخطوة 3: "الموعد". نظام MedBook يمنح المريض أول دور شاغر لدى الطبيب تلقائيًا (الأدوار بالترتيب،
// وهو قلب إدارة الطابور في العيادة) — لذلك نعرض التاريخ والوقت اللذين سيُحجزان، وليس منتقي تاريخ/وقت يدويًا.
export const SlotStep = forwardRef<HTMLHeadingElement, Props>(
  ({ doctor, slot, loading, errorKind, errorMessage, onRetry, onContinue, onBack, backLabel, choice, picker }, ref) => {
    const address = doctorAddress(doctor);
    return (
      <section aria-labelledby="step-slot-title">
        <BackButton onClick={onBack}>{backLabel}</BackButton>
        <StepHeading
          ref={ref}
          id="step-slot-title"
          hint={choice ? "اخترت اليوم بنفسك — سيتحقق النظام من توفره لحظة تأكيد الحجز." : "هذا أقرب موعد متاح لدى الطبيب، ويُمنح حسب أسبقية الحجز."}
        >
          موعدك
        </StepHeading>

        <div className="mb-4 flex items-center gap-3 glass p-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600" aria-hidden="true">
            <Stethoscope className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-slate-500">الطبيب المختار</p>
            <p className="font-bold text-slate-900">
              د. {doctor.firstName} {doctor.lastName}
            </p>
            <p className="text-sm text-primary-700">{doctor.specialty.nameAr}</p>
          </div>
        </div>

        {choice ? (
          <div className="rounded-2xl border border-primary-200 bg-primary-50/70 p-5 backdrop-blur-md text-center" aria-live="polite">
            <p className="text-xs font-semibold text-primary-700">اختيارك</p>
            <p className="mt-1 text-lg font-extrabold text-primary-800">{formatLongDate(choice.date)}</p>
            <p className={`mt-2 font-extrabold text-primary-700 ${choice.startTime ? "text-3xl" : "text-base"}`} dir={choice.startTime ? "ltr" : undefined}>
              {choice.startTime ?? "أول وقت متاح في هذا اليوم"}
            </p>
            {address && (
              <p className="mt-3 flex items-center justify-center gap-1.5 border-t border-primary-100 pt-3 text-sm font-semibold text-slate-700">
                <MapPin className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" /> {address}
              </p>
            )}
          </div>
        ) : loading && !slot ? (
          <SlotSkeleton />
        ) : slot ? (
          <div className="rounded-2xl border border-primary-200 bg-primary-50/70 p-5 backdrop-blur-md text-center" aria-live="polite">
            <p className="flex items-center justify-center gap-1.5 text-sm text-slate-600">
              <CalendarDays className="h-4 w-4" aria-hidden="true" /> التاريخ
            </p>
            <p className="mt-1 text-lg font-extrabold text-primary-800">{formatLongDate(slot.date)}</p>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-slate-600">
              <Clock className="h-4 w-4" aria-hidden="true" /> الوقت
            </p>
            <p className="text-3xl font-extrabold text-primary-700" dir="ltr">
              {slot.startTime}
            </p>
            <p className="mt-2 text-xs text-slate-500">مدة الجلسة {slot.slotMinutes} دقيقة</p>
            {address && (
              <p className="mt-3 flex items-center justify-center gap-1.5 border-t border-primary-100 pt-3 text-sm font-semibold text-slate-700">
                <MapPin className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" /> {address}
              </p>
            )}
          </div>
        ) : errorKind === "noSlots" ? (
          <div role="alert" className="glass border-dashed p-8 text-center">
            <p className="font-bold text-slate-800">لا توجد مواعيد متاحة حاليًا لدى هذا الطبيب.</p>
            <p className="mt-1 text-sm text-slate-500">جرّب طبيبًا آخر أو عد لاحقًا.</p>
          </div>
        ) : (
          <InlineError title="تعذّر تحميل الموعد." message={errorMessage} onRetry={onRetry} />
        )}

        {picker}

        <button
          type="button"
          onClick={onContinue}
          disabled={!slot && !choice}
          className="btn-primary mt-5 min-h-[48px] w-full text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          متابعة إلى بيانات المريض
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </section>
    );
  }
);
SlotStep.displayName = "SlotStep";
