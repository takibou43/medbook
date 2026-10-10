import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useState } from "react";
import { ArrowLeftRight, Stethoscope } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { apiErrorMessage } from "../../lib/api";
import { portalUrl } from "../../lib/portalSwitch";
import { useToast } from "../ui/Toast";

const DOCTOR_SITE = import.meta.env.VITE_DOCTOR_SITE_URL ?? "https://medbook-doctor.vercel.app";

const STATUS_LABEL = { PENDING: "طلبك قيد مراجعة الإدارة", VERIFIED: "ملف الطبيب معتمد", REJECTED: "طلب الطبيب غير معتمد" } as const;

/**
 * «ملفاتي»: لحساب يملك ملف طبيب، انتقال واضح إلى لوحة الأطباء بالجلسة نفسها (دون كلمة مرور ودون رموز في الرابط)،
 * ولحساب مريض بلا ملف طبيب، طريق تقديم طلب الطبيب من الحساب نفسه. تقديم الطلب لا يعني الاعتماد.
 */
export function ProfilesCard() {
  useLanguage();
  const { user, prepareSwitchToDoctor } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const profiles = user?.profiles;
  if (!profiles || (!profiles.doctor && !profiles.canApplyAsDoctor)) return null;

  async function goDoctor() {
    setBusy(true);
    try {
      await prepareSwitchToDoctor();
      window.location.href = portalUrl(DOCTOR_SITE, "/");
    } catch (err) {
      showToast(apiErrorMessage(err, t("تعذّر فتح لوحة الأطباء.")), "error");
      setBusy(false);
    }
  }

  return (
    <section className="glass space-y-3 p-4" aria-labelledby="profiles-title">
      <h2 id="profiles-title" className="flex items-center gap-2 font-bold text-slate-900">
        <Stethoscope className="h-5 w-5 text-primary-600" aria-hidden="true" />{t(" حسابي كطبيب ")}</h2>
      {profiles.doctor ? (
        <>
          <p className="text-sm text-slate-600">{STATUS_LABEL[profiles.doctor.status]}{t(". حسابك واحد بالبريد والهاتف نفسيهما.")}</p>
          <button type="button" onClick={goDoctor} disabled={busy} className="btn-primary min-h-[48px] w-full">
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" /> {busy ? t("جارٍ الانتقال…") : t("الانتقال إلى لوحة الأطباء")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm leading-6 text-slate-600">{t("هل أنت طبيب؟ قدّم طلبك من حسابك نفسه دون إنشاء حساب آخر. سجّل الدخول في موقع الأطباء بالبريد وكلمة المرور نفسيهما ثم أكمل بياناتك المهنية. يخضع الطلب لمراجعة الإدارة، وتبقى مواعيدك كمريض كما هي. ")}</p>
          <a href={portalUrl(DOCTOR_SITE, "/login")} className="btn-primary flex min-h-[48px] w-full items-center justify-center">{t("التسجيل كطبيب بحسابي الحالي ")}</a>
        </>
      )}
    </section>
  );
}
