import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName, getLocale } from "../../i18n/locale.ts";
import { forwardRef, ReactNode, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Clock, MapPin, Stethoscope } from "lucide-react";
import { Doctor, NextSlot } from "../../types";
import { doctorAddress } from "../../lib/booking";
import { isUpcomingSlot } from "../../lib/nextSlot";
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
  useLanguage();
    const address = doctorAddress(doctor);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), 15_000);
      const update = () => setNow(Date.now());
      document.addEventListener("visibilitychange", update);
      return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
    }, []);
    const validSlot = errorKind === "none" && isUpcomingSlot(slot, now) ? slot : undefined;
    const day = choice?.date ?? validSlot?.date;
    const time = choice ? choice.startTime : validSlot?.startTime;
    const today = new Date(now + 3_600_000).toISOString().slice(0, 10);
    const dateLabel = day ? `${day.slice(0, 10) === today ? t("اليوم") + "، " : ""}${new Date(day.slice(0, 10) + "T12:00:00Z").toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Algiers", ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" as const } : {}) })}` : "";
    const choiceValid = choice && (choice.startTime ? isUpcomingSlot({ date: choice.date, startTime: choice.startTime, endTime: "", slotMinutes: 0 }, now) : choice.date >= today);
    return (
      <section aria-labelledby="step-slot-title">
        <BackButton onClick={onBack}>{backLabel}</BackButton>
        <StepHeading ref={ref} id="step-slot-title" hint={t("هذا أقرب موعد متاح. يمكنك اختيار موعد آخر.")}>{t("موعدك")}</StepHeading>
        <div className="glass p-4">
          <div className="flex items-center gap-3 border-b border-primary-100 pb-3">
            <Stethoscope className="h-7 w-7 shrink-0 text-primary-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="break-words text-sm font-bold text-slate-900">{t("د. ")}{doctor.firstName} {doctor.lastName}</p>
              <p className="text-xs text-primary-700">{catalogName(doctor.specialty)}</p>
            </div>
          </div>
          {day ? <div className="py-3" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-bold text-primary-800"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />{dateLabel}</p>
            <p className="mt-2 flex items-center gap-2 font-extrabold text-primary-700"><Clock className="h-4 w-4 shrink-0" aria-hidden="true" /><bdi className={time ? "text-3xl" : "text-sm"}>{time ?? t("أول وقت متاح في هذا اليوم")}</bdi></p>
            {!choice && validSlot && <p className="mt-1 text-xs text-slate-500">{t("مدة الجلسة ")}{validSlot.slotMinutes}{t(" دقيقة")}</p>}
            {choice && !choiceValid && <p role="alert" className="mt-2 text-sm text-amber-800">{t("هذا الموعد مضى. اختر موعدًا آخر.")}</p>}
          </div> : loading ? <SlotSkeleton /> : errorKind === "noSlots" ? <p role="status" className="py-3 text-sm">{t("لا توجد مواعيد متاحة حاليًا لدى هذا الطبيب.")}</p> : <div className="py-3"><InlineError title={t("تعذّر تحميل الموعد.")} message={errorMessage ?? t("الموعد المعروض مضى. حدّث التوفر للمحاولة مجددًا.")} onRetry={onRetry} /></div>}
          {address && <p className="flex items-start gap-1.5 border-t border-primary-100 pt-2 text-xs text-slate-600"><MapPin className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" /><span className="break-words">{address}</span></p>}
        </div>
        {picker}
        <div className="sticky bottom-0 z-20 mt-3 rounded-2xl glass-chrome p-2" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
          <button type="button" onClick={() => { const fresh = Date.now(); setNow(fresh); const valid = choice ? choice.startTime ? isUpcomingSlot({ date: choice.date, startTime: choice.startTime, endTime: "", slotMinutes: 0 }, fresh) : choice.date >= new Date(fresh + 3_600_000).toISOString().slice(0, 10) : isUpcomingSlot(slot, fresh); if (valid) onContinue(); else onRetry(); }} disabled={choice ? !choiceValid : !validSlot} className="btn-primary min-h-[48px] w-full text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">{t("متابعة")}<ArrowLeft className="h-4 w-4 ltr:rotate-180" aria-hidden="true" /></button>
        </div>
      </section>
    );
  }
);
SlotStep.displayName = "SlotStep";
