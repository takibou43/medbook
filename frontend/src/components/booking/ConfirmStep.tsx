import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
import { forwardRef } from "react";
import { CalendarDays } from "lucide-react";
import { Doctor, NextSlot } from "../../types";
import { doctorAddress, formatLongDate } from "../../lib/booking";
import { Button } from "../ui/Button";
import { StepHeading, BackButton } from "./StepParts";

interface Props {
  doctor: Doctor;
  slot: NextSlot;
  patientName: string;
  patientPhone: string;
  submitting: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onBack: () => void;
  // الوقت اختاره المريض بنفسه (لا نقل تلقائي إلى وقت آخر إن أُخذ).
  exactChoice?: boolean;
  // الحساب العائلي: «ياسين بن علي (ابن/ابنة)» — يُعرض بوضوح قبل التأكيد. غيابه = الموعد لصاحب الحساب.
  beneficiaryLabel?: string | null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  useLanguage();
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-slate-500">{t(label ?? "")}</dt>
      <dd className="text-end text-sm font-semibold text-slate-800">{children}</dd>
    </div>
  );
}

// الخطوة 5: ملخص واضح قبل الإرسال. الخادم هو المرجع النهائي للدور (يعيد حسابه لحظة الحجز
// ويمنع التكرار)، وشاشة النجاح تعرض الدور الفعلي الذي سجّله.
export const ConfirmStep = forwardRef<HTMLHeadingElement, Props>(
  ({ doctor, slot, patientName, patientPhone, submitting, errorMessage, onConfirm, onBack, exactChoice, beneficiaryLabel }, ref) => {
  useLanguage();
    const address = doctorAddress(doctor);
    return (
      <section aria-labelledby="step-confirm-title">
        <BackButton onClick={onBack}>{t("تعديل البيانات")}</BackButton>
        <StepHeading ref={ref} id="step-confirm-title" hint={t("راجع بياناتك ثم أكّد الحجز.")}>{t("تأكيد الحجز ")}</StepHeading>

        <dl className="glass divide-y divide-slate-100 px-5 py-2">
          <Row label={t("التخصص")}>{catalogName(doctor.specialty)}</Row>
          <Row label={t("الطبيب")}>{t("د. ")}{doctor.firstName} {doctor.lastName}
          </Row>
          {address && <Row label={t("العنوان")}>{address}</Row>}
          <Row label={t("التاريخ")}>{formatLongDate(slot.date)}</Row>
          <Row label={t("الوقت")}>
            {/^\d{2}:\d{2}$/.test(slot.startTime) ? <span dir="ltr">{slot.startTime}</span> : slot.startTime}
          </Row>
          {beneficiaryLabel ? (
            <Row label={t("الموعد لـ")}>
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-primary-800">{beneficiaryLabel}</span>
            </Row>
          ) : (
            <Row label={t("اسم المريض")}>{patientName}</Row>
          )}
          <Row label={t("رقم الهاتف")}>{patientPhone ? <span dir="ltr">{patientPhone}</span> : "—"}</Row>
        </dl>

        <p className="mt-3 text-xs text-slate-500">
          {exactChoice
            ? t("الخادم يتحقق من توفر الوقت لحظة التأكيد؛ إن حُجز قبلك للتوّ سنطلب منك اختيار وقت آخر.")
            : t("الأدوار تُمنح بالترتيب؛ إن حُجز هذا الوقت قبلك للتوّ سيُعطى لك الدور التالي مباشرة.")}
        </p>

        {errorMessage && (
          <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        <Button type="button" onClick={onConfirm} loading={submitting} className="mt-4 min-h-[48px] w-full text-base">
          <CalendarDays className="me-1.5 h-4 w-4" aria-hidden="true" />{t(" تأكيد الحجز ")}</Button>
      </section>
    );
  }
);
ConfirmStep.displayName = "ConfirmStep";
