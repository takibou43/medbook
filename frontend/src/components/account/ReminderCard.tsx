import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2 } from "lucide-react";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { PushState, disablePatientPush, enablePatientPush, getPushState } from "../../lib/patientPush";

// بطاقة «ذكّرني بموعدي»: لا تطلب الإذن من تلقاء نفسها أبدًا — فقط عند ضغط الزر، وإن رفض المريض
// لا نلحّ عليه بنوافذ متكررة؛ نعرض الحالة مع إمكانية المحاولة مجددًا متى شاء.
export function ReminderCard({ compact = false }: { compact?: boolean }) {
  useLanguage();
  const { showToast } = useToast();
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setHint(null);
    try {
      const r = await enablePatientPush();
      if (r.ok) {
        setState("enabled");
        showToast(t("تم تفعيل التذكير بمواعيدك ✓"), "success");
      } else {
        setState(await getPushState());
        setHint(r.reason ?? null);
      }
    } catch (err) {
      setHint(apiErrorMessage(err, t("تعذّر تفعيل الإشعارات. حاول مرة أخرى.")));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await disablePatientPush();
      setState(await getPushState());
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  if (state === "enabled") {
    return (
      <div className="glass flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />{t(" الإشعارات مفعّلة ✓ ")}</p>
        {!compact && (
          <>
            <p className="w-full text-xs text-slate-500">{t("سيصلك تذكير قبل موعدك بساعة وقبل 5 دقائق.")}</p>
            <button type="button" onClick={disable} disabled={busy} className="text-xs font-semibold text-slate-500 hover:underline">{t("إيقاف الإشعارات على هذا الجهاز ")}</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="glass p-4">
      <p className="flex items-center gap-2 font-bold text-slate-900">
        <Bell className="h-5 w-5 text-primary-600" aria-hidden="true" />{t(" 🔔 ذكّرني بموعدي ")}</p>
      <p className="mt-1 text-sm text-slate-600">{t("فعّل الإشعارات ليصلك تذكير قبل موعدك بساعة وقبل 5 دقائق.")}</p>

      {state === "unsupported" ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-slate-500">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t("متصفحك لا يدعم الإشعارات. على آيفون: أضِف الموقع إلى الشاشة الرئيسية ثم افتحه منها. ")}</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-500">
            {state === "denied" ? t("الإشعارات محظورة في إعدادات المتصفح لهذا الموقع.") : t("الإشعارات غير مفعّلة")}
          </p>
          <Button className="mt-3 min-h-[44px] w-full" onClick={enable} loading={busy}>
            {state === "denied" ? t("المحاولة مرة أخرى") : t("تفعيل الإشعارات")}
          </Button>
        </>
      )}
      {hint && <p className="mt-2 text-sm text-amber-700">{t(hint ?? "")}</p>}
    </div>
  );
}
