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
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className="text-end text-sm font-semibold text-slate-800">{children}</dd>
    </div>
  );
}

// الخطوة 5: ملخص واضح قبل الإرسال. الخادم هو المرجع النهائي للدور (يعيد حسابه لحظة الحجز
// ويمنع التكرار)، وشاشة النجاح تعرض الدور الفعلي الذي سجّله.
export const ConfirmStep = forwardRef<HTMLHeadingElement, Props>(
  ({ doctor, slot, patientName, patientPhone, submitting, errorMessage, onConfirm, onBack, exactChoice }, ref) => {
    const address = doctorAddress(doctor);
    return (
      <section aria-labelledby="step-confirm-title">
        <BackButton onClick={onBack}>تعديل البيانات</BackButton>
        <StepHeading ref={ref} id="step-confirm-title" hint="راجع بياناتك ثم أكّد الحجز.">
          تأكيد الحجز
        </StepHeading>

        <dl className="glass divide-y divide-slate-100 px-5 py-2">
          <Row label="التخصص">{doctor.specialty.nameAr}</Row>
          <Row label="الطبيب">
            د. {doctor.firstName} {doctor.lastName}
          </Row>
          {address && <Row label="العنوان">{address}</Row>}
          <Row label="التاريخ">{formatLongDate(slot.date)}</Row>
          <Row label="الوقت">
            {/^\d{2}:\d{2}$/.test(slot.startTime) ? <span dir="ltr">{slot.startTime}</span> : slot.startTime}
          </Row>
          <Row label="اسم المريض">{patientName}</Row>
          <Row label="رقم الهاتف">{patientPhone ? <span dir="ltr">{patientPhone}</span> : "—"}</Row>
        </dl>

        <p className="mt-3 text-xs text-slate-500">
          {exactChoice
            ? "الخادم يتحقق من توفر الوقت لحظة التأكيد؛ إن حُجز قبلك للتوّ سنطلب منك اختيار وقت آخر."
            : "الأدوار تُمنح بالترتيب؛ إن حُجز هذا الوقت قبلك للتوّ سيُعطى لك الدور التالي مباشرة."}
        </p>

        {errorMessage && (
          <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        <Button type="button" onClick={onConfirm} loading={submitting} className="mt-4 min-h-[48px] w-full text-base">
          <CalendarDays className="ml-1.5 h-4 w-4" aria-hidden="true" /> تأكيد الحجز
        </Button>
      </section>
    );
  }
);
ConfirmStep.displayName = "ConfirmStep";
