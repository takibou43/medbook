import { useLanguage } from "../i18n/LanguageRoot";
import { t } from "../i18n/locale";
import { useState } from "react";
import { Stethoscope, UserRound, ArrowLeftRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useWilayas } from "../hooks/useCatalog";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { useToast } from "./ui/Toast";
import { apiErrorMessage } from "../lib/api";
import { portalUrl } from "../lib/portalSwitch";

const PATIENT_SITE = import.meta.env.VITE_MAIN_SITE_URL ?? "https://medbook-alpha.vercel.app";

/**
 * «ملفاتي»: حالة ملفي الطبيب والمريض في الحساب نفسه، وتفعيل ملف المريض، والانتقال إلى واجهة المرضى.
 * تفعيل ملف المريض لا يمنح أي صلاحية طبيب جديدة، ولا يُنشئ حسابًا آخر.
 */
export function ProfilesCard() {
  useLanguage();
  const { user, addPatientProfile, prepareSwitchToPatient } = useAuth();
  const { showToast } = useToast();
  const { data: wilayas } = useWilayas();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [wilayaId, setWilayaId] = useState("");
  const [cityId, setCityId] = useState("");
  const [busy, setBusy] = useState(false);
  const profiles = user?.profiles;
  if (!profiles || user?.role !== "DOCTOR") return null;
  const cities = wilayas?.find((w) => w.id === wilayaId)?.cities ?? [];

  async function activate() {
    setBusy(true);
    try {
      await addPatientProfile({ password, ...(cityId ? { cityId } : {}) });
      setPassword("");
      setOpen(false);
      showToast(t("تم تفعيل ملف المريض. يمكنك الآن الحجز لنفسك من واجهة المرضى."), "success");
    } catch (err) {
      showToast(apiErrorMessage(err, t("تعذّر تفعيل ملف المريض.")), "error");
    } finally {
      setBusy(false);
    }
  }

  async function goPatient() {
    setBusy(true);
    try {
      await prepareSwitchToPatient();
      window.location.href = portalUrl(PATIENT_SITE, "/account");
    } catch (err) {
      showToast(apiErrorMessage(err, t("تعذّر فتح واجهة المرضى.")), "error");
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4 p-6" aria-labelledby="profiles-title">
      <div>
        <h2 id="profiles-title" className="text-lg font-extrabold text-slate-900">{t("ملفاتي في هذا الحساب")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("حساب واحد بالبريد والهاتف نفسيهما. تفعيل ملف المريض لا يغيّر صلاحياتك كطبيب.")}</p>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
        <Stethoscope className="h-5 w-5 text-primary-700" aria-hidden />
        <span className="font-semibold">{t("ملف الطبيب")}</span>
        <span className="mr-auto text-slate-600">{profiles.doctor?.status === "VERIFIED" ? t("معتمد") : profiles.doctor?.status === "REJECTED" ? t("مرفوض") : t("قيد المراجعة")}</span>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
        <UserRound className="h-5 w-5 text-primary-700" aria-hidden />
        <span className="font-semibold">{t("ملف المريض")}</span>
        <span className="mr-auto text-slate-600">{profiles.patient ? t("مفعّل") : t("غير مفعّل")}</span>
      </div>

      {profiles.patient ? (
        <Button type="button" onClick={goPatient} loading={busy} className="min-h-[48px] w-full">
          <ArrowLeftRight className="h-4 w-4" aria-hidden />{t(" الانتقال إلى واجهة المرضى ")}</Button>
      ) : profiles.canAddPatientProfile ? (
        open ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="pp-wilaya">{t("الولاية (اختياري)")}</label>
                <select id="pp-wilaya" className="input" value={wilayaId} onChange={(e) => { setWilayaId(e.target.value); setCityId(""); }}>
                  <option value="">—</option>
                  {wilayas?.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="pp-city">{t("البلدية (اختياري)")}</label>
                <select id="pp-city" className="input" disabled={!wilayaId} value={cityId} onChange={(e) => setCityId(e.target.value)}>
                  <option value="">—</option>
                  {cities.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                </select>
              </div>
            </div>
            <Input label={t("كلمة المرور الحالية (للتأكيد)")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-2">
              <Button type="button" onClick={activate} loading={busy} disabled={!password} className="min-h-[48px] flex-1">{t("تفعيل ملف المريض")}</Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="min-h-[48px]">{t("إلغاء")}</Button>
            </div>
          </div>
        ) : (
          <Button type="button" onClick={() => setOpen(true)} className="min-h-[48px] w-full">{t("تفعيل ملف مريض في حسابي")}</Button>
        )
      ) : null}
    </section>
  );
}

/** زر الانتقال السريع إلى واجهة المرضى في الشريط الجانبي/قائمة الهاتف — يظهر فقط لحساب يملك الملفين. */
export function SwitchToPatientButton({ className, onDone, compact = false }: { className?: string; onDone?: () => void; /** وضع القائمة المطوية: أيقونة فقط مع اسم مقروء لقارئات الشاشة وتلميح. */ compact?: boolean }) {
  useLanguage();
  const { user, prepareSwitchToPatient } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  if (user?.role !== "DOCTOR" || !user.profiles?.patient) return null;
  async function go() {
    setBusy(true);
    try {
      await prepareSwitchToPatient();
      onDone?.();
      window.location.href = portalUrl(PATIENT_SITE, "/account");
    } catch (err) {
      showToast(apiErrorMessage(err, t("تعذّر فتح واجهة المرضى.")), "error");
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={go} disabled={busy} className={className ?? "btn-ghost w-full justify-start"} title={compact ? t("واجهة المرضى") : undefined}>
      <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden />
      <span className={compact ? "sr-only" : undefined}>{busy ? t("جارٍ الانتقال…") : t("واجهة المرضى")}</span>
    </button>
  );
}
