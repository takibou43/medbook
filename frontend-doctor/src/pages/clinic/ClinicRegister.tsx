import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { apiErrorMessage } from "../../lib/api";
import { ClinicProfileFields, DoctorProfileFields, profileFromForm, doctorFromForm } from "./ClinicForms";
export default function ClinicRegister() {
  useLanguage();
  const { registerClinic } = useAuth(); const navigate = useNavigate();
  const [practices, setPractices] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError("");
    try {
      await registerClinic({ email: form.get("email"), password: form.get("password"), clinic: profileFromForm(form), ...(practices ? { doctor: doctorFromForm(form) } : {}) });
      navigate("/clinic");
    } catch (err) { setError(apiErrorMessage(err, t("تعذر تسجيل العيادة."))); } finally { setBusy(false); }
  }
  return <main className="container-app mx-auto max-w-xl py-10">
    <h1 className="mb-2 text-2xl font-extrabold">{t("سجّل عيادتك في MedBook")}</h1>
    <p className="mb-5 text-slate-600">{t("اشتراك واحد للعيادة: 4,000 دج شهريًا لكل طبيب، شامل حسابات المساعدين. تُراجع الإدارة العيادة والأطباء قبل إتاحة الحجز.")}</p>
    <form onSubmit={submit} className="card space-y-4 p-6">
      <Input name="email" label={t("بريد صاحب العيادة")} type="email" required />
      <Input name="password" label={t("كلمة المرور")} type="password" required minLength={8} autoComplete="new-password" />
      <ClinicProfileFields />
      <label className="flex items-center gap-2"><input type="checkbox" checked={practices} onChange={e => setPractices(e.target.checked)} />{t("أعمل طبيبًا داخل العيادة أيضًا")}</label>
      {practices && <><DoctorProfileFields /><p className="text-sm text-slate-600">{t("تُحتسب طبيبًا واحدًا في الاشتراك، وتستخدم الحساب نفسه لإدارة العيادة ومواعيدك.")}</p></>}
      {error && <p role="alert" className="text-red-600">{t(error ?? "")}</p>}
      <Button type="submit" loading={busy}>{t("إنشاء العيادة والحساب")}</Button>
    </form>
    <p className="mt-4"><Link to="/login" className="text-primary-700">{t("لديك حساب طبيب؟ سجّل الدخول ثم افتح «إدارة العيادة».")}</Link></p>
  </main>;
}
