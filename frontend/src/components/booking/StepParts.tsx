import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { forwardRef, ReactNode } from "react";
import { ArrowRight } from "lucide-react";

// عنوان كل خطوة: يستقبل التركيز برمجيًا (tabIndex=-1) عند الانتقال بين الخطوات ليعلنه قارئ الشاشة،
// وله scroll-mt حتى لا تخفيه الترويسة اللاصقة عند التمرير التلقائي.
export const StepHeading = forwardRef<HTMLHeadingElement, { children: ReactNode; hint?: string; id?: string }>(({ children, hint, id }, ref) => { useLanguage(); return (
  <div className="mb-4">
    <h2 ref={ref} id={id} tabIndex={-1} data-step-heading className="scroll-mt-24 text-xl font-extrabold text-slate-900 outline-none">
      {children}
    </h2>
    {hint && <p className="mt-1 text-sm text-slate-500">{t(hint ?? "")}</p>}
  </div>
); });
StepHeading.displayName = "StepHeading";

// زر الرجوع — السهم يشير لليمين لأن الواجهة RTL (الرجوع = اتجاه بداية القراءة).
export function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
  );
}

// رسالة خطأ/تنبيه مفهومة للمريض مع زر إعادة المحاولة اختياريًا — لا تكسر الصفحة ولا تعرض أخطاء تقنية.
export function InlineError({ title, message, onRetry, retryLabel = t("إعادة المحاولة") }: { title: string; message?: string; onRetry?: () => void; retryLabel?: string }) {
  useLanguage();
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
      <p className="font-bold text-red-700">{t(title ?? "")}</p>
      {message && <p className="mt-1 text-sm text-red-600">{t(message ?? "")}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-red-300 bg-white px-5 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          {t(retryLabel ?? "")}
        </button>
      )}
    </div>
  );
}
