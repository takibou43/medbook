import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
import { forwardRef } from "react";
import { CalendarDays } from "lucide-react";
import { Doctor, NextSlot } from "../../types";
import { doctorAddress, formatLongDate } from "../../lib/booking";
import { Button } from "../ui/Button";
import { StepHeading, BackButton } from "./StepParts";

interface Props {
  doctor: Doctor; slot: NextSlot; patientName: string; patientPhone: string;
  submitting: boolean; errorMessage: string | null;
  onConfirm: () => void; onBack: () => void; onEditDoctor?: () => void; onEditSlot?: () => void;
  exactChoice?: boolean; beneficiaryLabel?: string | null;
}
export const ConfirmStep = forwardRef<HTMLHeadingElement, Props>(
  ({ doctor, slot, patientName, patientPhone, submitting, errorMessage, onConfirm, onBack, onEditDoctor, onEditSlot, beneficiaryLabel }, ref) => {
    useLanguage();
    const address = doctorAddress(doctor);
    const edit = (label: string, action?: () => void) => action && <button type="button" disabled={submitting} onClick={action} className="min-h-[44px] shrink-0 px-2 text-xs font-semibold text-primary-700 underline disabled:opacity-50">{t(label)}</button>;
    return <section aria-labelledby="step-confirm-title">
      <BackButton onClick={onBack} disabled={submitting}>{t("تعديل البيانات")}</BackButton>
      <StepHeading ref={ref} id="step-confirm-title">{t("تأكيد الحجز")}</StepHeading>
      <div className="glass divide-y divide-slate-100 px-4">
        <div className="flex items-start justify-between gap-2 py-3">
          <div className="min-w-0 text-sm">
            <p className="break-words font-bold text-slate-900">{t("د. ")}{doctor.firstName} {doctor.lastName}</p>
            <p className="mt-1 text-primary-700">{catalogName(doctor.specialty)}</p>
            {address && <p className="mt-1 break-words text-xs text-slate-600">{address}</p>}
          </div>{edit("تغيير الطبيب", onEditDoctor)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <p className="min-w-0 text-sm font-semibold text-slate-800">{formatLongDate(slot.date)} <bdi>{slot.startTime}</bdi></p>
          {edit("تغيير الموعد", onEditSlot)}
        </div>
        <div className="flex items-start justify-between gap-2 py-3">
          <div className="min-w-0 text-sm">
            <p className="text-xs text-slate-500">{t("الموعد لـ")}</p>
            <p className="mt-1 break-words font-bold text-slate-900">{beneficiaryLabel || patientName}</p>
            <p className="mt-1 text-slate-600"><bdi>{patientPhone || "—"}</bdi></p>
          </div>{edit("تعديل البيانات", onBack)}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-600">{t("يتحقق النظام من التوفر عند التأكيد")}</p>
      {errorMessage && <p role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage}</p>}
      <div className="sticky bottom-0 z-20 mt-3 rounded-2xl glass-chrome p-2" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        <Button type="button" onClick={onConfirm} loading={submitting} className="min-h-[48px] w-full text-base"><CalendarDays className="me-1.5 h-4 w-4" aria-hidden="true" />{t("تأكيد الحجز")}</Button>
      </div>
    </section>;
  }
);
ConfirmStep.displayName = "ConfirmStep";
