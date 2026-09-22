import { forwardRef } from "react";
import { UseFormReturn } from "react-hook-form";
import { ArrowLeft } from "lucide-react";
import { Input } from "../ui/Input";
import { PHONE_REGEX, splitFullName } from "../../lib/booking";
import { StepHeading, BackButton } from "./StepParts";

export interface PatientForm {
  fullName: string;
  phone: string;
}

interface Props {
  form: UseFormReturn<PatientForm>;
  onSubmit: () => void;
  onBack: () => void;
}

// الخطوة 4: "معلومات المريض" — لا تظهر إلا بعد اختيار الطبيب والموعد.
// الحقول كما كانت: الاسم واللقب (يُقسَّم لـ firstName/lastName للخادم) + هاتف جزائري اختياري.
export const PatientStep = forwardRef<HTMLHeadingElement, Props>(({ form, onSubmit, onBack }, ref) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  return (
    <section aria-labelledby="step-patient-title">
      <BackButton onClick={onBack}>تغيير الموعد</BackButton>
      <StepHeading ref={ref} id="step-patient-title" hint="الاسم الذي سيظهر للطبيب في الطابور.">
        معلومات المريض
      </StepHeading>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="glass space-y-4 p-5">
        <Input
          label="الاسم واللقب"
          placeholder="مثال: محمد بن علي"
          autoComplete="name"
          autoFocus
          error={errors.fullName?.message}
          {...register("fullName", {
            required: "الرجاء كتابة الاسم واللقب",
            validate: (v) => splitFullName(v) !== null || "اكتب الاسم واللقب معًا (كلمتان على الأقل)",
          })}
        />
        <Input
          label="رقم الهاتف (اختياري)"
          placeholder="0551234567"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          className="text-left"
          error={errors.phone?.message}
          {...register("phone", { pattern: { value: PHONE_REGEX, message: "رقم هاتف جزائري غير صالح (مثال: 0551234567)" } })}
        />
        <button
          type="submit"
          className="btn-primary min-h-[48px] w-full text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          مراجعة الحجز
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
});
PatientStep.displayName = "PatientStep";
