import { forwardRef, ReactNode } from "react";
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
  /** اختيار المستفيد (الحساب العائلي) — يظهر لصاحب الحساب المسجَّل. */
  beneficiary?: ReactNode;
  /** الموعد لفرد من العائلة: الاسم يؤخذ من ملف الفرد (لا يُكتب يدويًا). */
  familyMemberName?: string | null;
  /** «لفرد من العائلة» مختار دون تحديد الفرد بعد. */
  familyPending?: boolean;
}

// الخطوة 4: "معلومات المريض" — لا تظهر إلا بعد اختيار الطبيب والموعد.
// الحقول كما كانت: الاسم واللقب (يُقسَّم لـ firstName/lastName للخادم) + هاتف جزائري اختياري.
// مع الحساب العائلي: يختار صاحب الحساب «الموعد لي» (كما كان) أو فردًا من عائلته — عندها يُعرض اسم الفرد
// ولا يُطلب كتابته، والهاتف يبقى هاتف صاحب الحساب.
export const PatientStep = forwardRef<HTMLHeadingElement, Props>(({ form, onSubmit, onBack, beneficiary, familyMemberName, familyPending }, ref) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;
  const forFamily = Boolean(familyMemberName);

  return (
    <section aria-labelledby="step-patient-title">
      <BackButton onClick={onBack}>تغيير الموعد</BackButton>
      <StepHeading ref={ref} id="step-patient-title" hint="الاسم الذي سيظهر للطبيب في الطابور.">
        معلومات المريض
      </StepHeading>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="glass space-y-4 p-5">
        {beneficiary}
        {forFamily ? (
          <div className="rounded-xl bg-primary-50 p-3 text-sm text-primary-900">
            سيظهر للطبيب باسم: <span className="font-bold">{familyMemberName}</span>
          </div>
        ) : (
          !familyPending && (
            <Input
              label="الاسم واللقب"
              placeholder="مثال: محمد بن علي"
              autoComplete="name"
              autoFocus
              error={errors.fullName?.message}
              {...register("fullName", {
                validate: (v) => {
                  if (forFamily) return true;
                  if (!v.trim()) return "الرجاء كتابة الاسم واللقب";
                  return splitFullName(v) !== null || "اكتب الاسم واللقب معًا (كلمتان على الأقل)";
                },
              })}
            />
          )
        )}
        <Input
          label={forFamily ? "رقم هاتفك للتواصل (اختياري)" : "رقم الهاتف (اختياري)"}
          placeholder="0551234567"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          className="text-left"
          error={errors.phone?.message}
          {...register("phone", { pattern: { value: PHONE_REGEX, message: "رقم هاتف جزائري غير صالح (مثال: 0551234567)" } })}
        />
        {familyPending && (
          <p role="alert" className="text-sm text-amber-700">
            اختر فرد العائلة الذي تحجز له قبل المتابعة.
          </p>
        )}
        <button
          type="submit"
          disabled={familyPending}
          className="btn-primary min-h-[48px] w-full text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          مراجعة الحجز
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
});
PatientStep.displayName = "PatientStep";
