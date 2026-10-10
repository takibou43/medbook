import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { canAcceptClinicInvite } from "../../lib/clinicInvite";
import { formatDzd } from "../../lib/doctorUi";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { DoctorProfileFields, doctorFromForm } from "./ClinicForms";

interface InvitePreview {
  email: string; clinicName: string; existingAccount: boolean;
  appointmentPriceDzd: number | null; doctorSharePercent: number | null;
}

export default function ClinicDoctorInvite() {
  useLanguage();
  const { token } = useParams();
  const { user, logout, registerClinicDoctor, refreshMe } = useAuth();
  const navigate = useNavigate(); const location = useLocation();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [joined, setJoined] = useState(false);
  const query = useQuery({ queryKey: ["clinic-invite", token], queryFn: async () =>
    (await api.get<{ data: InvitePreview }>(`/clinics/invites/${token}`)).data.data, retry: false, enabled: !joined });
  const loginState = { returnTo: location.pathname, email: query.data?.email };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError("");
    try {
      if (user) {
        await api.post("/clinics/invites/accept", { token });
        await refreshMe();
      } else {
        await registerClinicDoctor({ token, password: form.get("password"), doctor: doctorFromForm(form) });
      }
      setJoined(true);
    } catch (err) { setError(apiErrorMessage(err, t("تعذر قبول الدعوة."))); } finally { setBusy(false); }
  }

  async function switchAccount() {
    setBusy(true); setError("");
    try { await logout(); navigate("/login", { state: loginState }); }
    catch (err) { setError(apiErrorMessage(err, t("تعذر تبديل الحساب."))); }
    finally { setBusy(false); }
  }

  if (joined) return <main className="container-app mx-auto max-w-lg space-y-4 py-10">
    <h1 className="text-2xl font-bold">{t("انضممت إلى ")}{query.data?.clinicName}</h1>
    <p>{t("تم قبول الدعوة وربط ملفك بالعيادة. لا تحتاج إلى موافقة الإدارة على الانضمام.")}</p>
    <Link to="/" className="btn-primary inline-flex min-h-[48px] items-center">{t("فتح لوحة الطبيب")}</Link>
  </main>;
  if (query.isPending) return <p className="p-8">{t("جارٍ التحقق من الدعوة…")}</p>;
  if (query.isError) return <main className="container-app space-y-4 py-10"><p role="alert" className="text-red-600">{apiErrorMessage(query.error, t("الدعوة غير صالحة."))}</p><p>{t("اطلب من العيادة رابط دعوة جديدًا إذا انتهت صلاحية الرابط.")}</p><Link to="/">{t("العودة إلى لوحة الطبيب")}</Link></main>;
  const invite = query.data;
  const eligible = canAcceptClinicInvite(user, invite.email);
  const sameEmail = user?.email.toLowerCase() === invite.email.toLowerCase();
  return <main className="container-app mx-auto max-w-lg space-y-5 py-10">
    <header><h1 className="text-2xl font-bold">{t("دعوة من ")}{invite.clinicName}</h1>
      <p className="mt-3">{t("البريد المدعو: ")}<b dir="ltr" className="break-all">{invite.email}</b></p>
      <p className="mt-2 text-slate-600">{t("اقبل الدعوة للانضمام مباشرة إلى العيادة. يرتبط الطبيب بعيادة واحدة، ويُدرج اشتراكه ضمن اشتراكها.")}</p>
    </header>
    {(invite.appointmentPriceDzd != null || invite.doctorSharePercent != null) && <section className="card space-y-2 p-5" aria-label={t("شروط الدعوة")}>
      <h2 className="font-bold">{t("شروط العيادة")}</h2>
      {invite.appointmentPriceDzd != null && <p>{t("سعر الكشف: ")}{formatDzd(invite.appointmentPriceDzd)}</p>}
      {invite.doctorSharePercent != null && <p>{t("نصيب الطبيب: ")}{invite.doctorSharePercent}{t("% · نصيب العيادة: ")}{100 - invite.doctorSharePercent}%</p>}
    </section>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-600">{t(error ?? "")}</p>}
    {user && !eligible ? <section className="card space-y-4 p-5">
      {!sameEmail ? <><p>{t("أنت داخل بحساب آخر. سجّل الدخول بالبريد المدعو لقبول الدعوة.")}</p><Button onClick={switchAccount} loading={busy}>{t("الدخول بالحساب المدعو")}</Button></>
        : user.role === "PATIENT" ? <><p>{t("حسابك يحمل ملف مريض فقط. أضف ملف الطبيب أولًا، ثم عد لقبول الدعوة.")}</p><Link to="/apply" state={loginState} className="font-bold text-primary-700 underline">{t("إضافة ملف طبيب إلى حسابي")}</Link></>
          : <p>{t("هذه الدعوة مخصصة لملف طبيب. استخدم حساب الطبيب المدعو.")}</p>}
    </section> : !user && invite.existingAccount ? <section className="card space-y-4 p-5">
      <p>{t("لديك حساب بهذا البريد. سجّل الدخول بكلمة مرورك الحالية، ثم اضغط «قبول الدعوة».")}</p>
      <Link to="/login" state={loginState} className="btn-primary flex min-h-[48px] items-center justify-center">{t("تسجيل الدخول وقبول الدعوة")}</Link>
    </section> : <form onSubmit={submit} className="card space-y-4 p-6">
      {user ? <p>{t("سيُضاف ملفك الحالي إلى العيادة دون إنشاء حساب جديد أو تغيير كلمة مرورك.")}</p>
        : <><DoctorProfileFields /><Input name="password" label={t("كلمة مرور حساب الطبيب الجديد")} type="password" minLength={8} required />
          <p className="text-sm text-slate-600">{t("اعتماد الملف المهني وإتاحة الحجز يخضعان للمراجعة المعتادة.")}</p></>}
      <Button type="submit" loading={busy} className="min-h-[48px] w-full">{user ? t("قبول الدعوة والانضمام") : t("إنشاء حساب وقبول الدعوة")}</Button>
    </form>}
    {!user && !invite.existingAccount && <p>{t("لديك حساب؟ ")}<Link className="font-bold text-primary-700" to="/login" state={loginState}>{t("تسجيل الدخول")}</Link></p>}
  </main>;
}
