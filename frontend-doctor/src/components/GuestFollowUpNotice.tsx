import { useLanguage } from "../i18n/LanguageRoot";
import { t } from "../i18n/locale.ts";

/** The existing server deliberately requires a patient account for follow-ups. */
export function GuestFollowUpNotice() {
  useLanguage();
  return <details className="text-xs text-slate-600">
    <summary className="cursor-pointer py-2 font-semibold">{t("موعد العودة للمريض بدون حساب")}</summary>
    <p className="mt-1 max-w-xl leading-5">{t("موعد العودة المرتبط بزيارة سابقة متاح للحسابات المسجلة فقط. لتنسيق العودة، تواصل مع الاستقبال مع مرجع الزيارة الحالية. عند حضور المريض، يتحقق المساعد من حجوزات اليوم قبل تسجيله عبر «تسجيل مريض حضر». هذا المسار لا يحجز عودة مستقبلية ولا يربط سجلات الضيف تلقائيًا.")}</p>
  </details>;
}
