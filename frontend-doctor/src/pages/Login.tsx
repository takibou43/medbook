import { useLanguage } from "../i18n/LanguageRoot";
import { t } from "../i18n/locale.ts";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { Logo } from "../components/ui/Logo";
import { apiErrorMessage } from "../lib/api";
import { clinicInviteReturnPath } from "../lib/clinicInvite";

interface FormValues {
  email: string;
  password: string;
}

export default function Login() {
  useLanguage();
  const { login, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = clinicInviteReturnPath(location.state?.returnTo);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { email: typeof location.state?.email === "string" ? location.state.email : "" } });

  async function onSubmit(values: FormValues) {
    setLoading(true);
    try {
      const user = await login(values.email, values.password);
      if (returnTo) {
        navigate(returnTo, { replace: true });
        return;
      }
      // مريض يسجّل دخوله هنا: يبقى بجلسته ويرى صفحة «قدّم كطبيب» لإضافة ملف الطبيب إلى حسابه نفسه.
      if (user.role === "PATIENT") {
        showToast(t("تم تسجيل الدخول. أكمل بيانات الطبيب لتقديم طلبك."), "success");
        navigate("/apply");
        return;
      }
      if (user.role !== "DOCTOR" && user.role !== "ADMIN" && user.role !== "ASSISTANT" && user.role !== "CLINIC_OWNER") {
        showToast(t("هذا الموقع مخصص لحسابات الأطباء والمساعدين والإدارة فقط."), "error");
        await logout();
        return;
      }
      showToast(t("تم تسجيل الدخول بنجاح."), "success");
      navigate(user.role === "ADMIN" ? "/admin" : user.role === "CLINIC_OWNER" ? "/clinic" : "/");
    } catch (err) {
      showToast(apiErrorMessage(err, t("بيانات الدخول غير صحيحة.")), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-app flex min-h-screen items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Logo className="mb-2 h-14 w-14" />
          <h1 className="text-xl font-extrabold text-slate-900">{t("تسجيل دخول الأطباء والعيادات والإدارة")}</h1>
          <p className="mt-1 text-center text-sm text-slate-500">{t("لوحة تحكم الطبيب والإدارة — إدارة المواعيد وجدول العمل والمرضى والمنصة.")}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
          <Input label={t("البريد الإلكتروني")} type="email" placeholder="you@example.com" error={errors.email?.message} {...register("email", { required: t("البريد الإلكتروني مطلوب") })} />
          <Input label={t("كلمة المرور")} type="password" placeholder="••••••••" error={errors.password?.message} {...register("password", { required: t("كلمة المرور مطلوبة") })} />
          <Button type="submit" className="w-full" loading={loading}>{t("تسجيل الدخول ")}</Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">{t("ليس لديك حساب طبيب؟")}{" "}
          <a href="/register" className="font-semibold text-primary-700 hover:underline">{t("انضم كطبيب ")}</a>
        </p>
        <p className="mt-2 text-center text-xs leading-5 text-slate-500">{t("لديك حساب مريض في MedBook؟ سجّل الدخول هنا بنفس البريد وكلمة المرور، ثم قدّم طلبك كطبيب من داخل حسابك دون إنشاء حساب آخر. ")}</p>
        <p className="mt-2 text-center text-sm text-slate-600"><a href="/register/clinic" className="font-semibold text-primary-700 hover:underline">{t("إنشاء حساب صاحب عيادة")}</a></p>
      </div>
    </div>
  );
}
