import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import clsx from "clsx";
import { useAuth } from "../../context/AuthContext";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { PHONE_REGEX } from "../../lib/booking";

type Mode = "login" | "register";

interface LoginValues {
  email: string;
  password: string;
}
interface RegisterValues extends LoginValues {
  name: string;
  phone: string;
}

const EMAIL_RULE = { required: "البريد الإلكتروني مطلوب", pattern: { value: /^\S+@\S+\.\S+$/, message: "بريد إلكتروني غير صالح" } };

// الوجهة بعد الدخول: مسار داخلي فقط (يبدأ بـ"/" ولا يبدأ بـ"//") — لا إعادة توجيه لمواقع خارجية.
function safeRedirect(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/account";
}

export default function AccountAuth() {
  const { user, loading, login, registerPatient } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "login");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirect = safeRedirect(params.get("redirect"));

  const loginForm = useForm<LoginValues>({ defaultValues: { email: "", password: "" } });
  const registerForm = useForm<RegisterValues>({ defaultValues: { name: "", email: "", password: "", phone: "" } });

  if (!loading && user) return <Navigate to={redirect} replace />;

  async function onLogin(v: LoginValues) {
    setSubmitting(true);
    setError(null);
    try {
      await login(v.email.trim(), v.password);
      showToast("تم تسجيل الدخول.", "success");
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "البريد الإلكتروني أو كلمة المرور غير صحيحة."));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRegister(v: RegisterValues) {
    setSubmitting(true);
    setError(null);
    try {
      await registerPatient({ name: v.name.trim(), email: v.email.trim(), password: v.password, phone: v.phone.trim() || undefined });
      showToast("تم إنشاء حسابك بنجاح.", "success");
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "تعذّر إنشاء الحساب."));
    } finally {
      setSubmitting(false);
    }
  }

  const tabClass = (m: Mode) =>
    clsx(
      "min-h-[44px] flex-1 rounded-xl text-sm font-bold transition",
      mode === m ? "bg-white text-primary-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
    );

  return (
    <div className="container-app py-8">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-center text-2xl font-extrabold text-slate-900">حسابي في مادبوك</h1>
        <p className="mb-6 text-center text-sm text-slate-600">
          الحساب اختياري — يتيح لك متابعة مواعيدك وتلقي تذكير قبل الموعد.{" "}
          <Link to="/" className="font-semibold text-primary-700 hover:underline">
            أو احجز مباشرة بدون حساب
          </Link>
        </p>

        <div className="mb-4 flex gap-1 rounded-2xl bg-slate-100 p-1" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "login"} className={tabClass("login")} onClick={() => { setMode("login"); setError(null); }}>
            تسجيل الدخول
          </button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={tabClass("register")} onClick={() => { setMode("register"); setError(null); }}>
            إنشاء حساب
          </button>
        </div>

        {mode === "login" ? (
          <form onSubmit={loginForm.handleSubmit(onLogin)} noValidate className="glass space-y-4 p-5">
            <Input label="البريد الإلكتروني" type="email" dir="ltr" className="text-left" autoComplete="email" error={loginForm.formState.errors.email?.message} {...loginForm.register("email", EMAIL_RULE)} />
            <Input label="كلمة المرور" type="password" dir="ltr" className="text-left" autoComplete="current-password" error={loginForm.formState.errors.password?.message} {...loginForm.register("password", { required: "كلمة المرور مطلوبة" })} />
            {error && <p className="text-sm font-semibold text-red-600" role="alert">{error}</p>}
            <Button type="submit" className="min-h-[48px] w-full" loading={submitting}>
              تسجيل الدخول
            </Button>
          </form>
        ) : (
          <form onSubmit={registerForm.handleSubmit(onRegister)} noValidate className="glass space-y-4 p-5">
            <Input label="الاسم واللقب" autoComplete="name" error={registerForm.formState.errors.name?.message} {...registerForm.register("name", { required: "الاسم مطلوب", minLength: { value: 2, message: "الاسم قصير جدًا" } })} />
            <Input label="البريد الإلكتروني" type="email" dir="ltr" className="text-left" autoComplete="email" error={registerForm.formState.errors.email?.message} {...registerForm.register("email", EMAIL_RULE)} />
            <Input label="كلمة المرور (8 خانات على الأقل)" type="password" dir="ltr" className="text-left" autoComplete="new-password" error={registerForm.formState.errors.password?.message} {...registerForm.register("password", { required: "كلمة المرور مطلوبة", minLength: { value: 8, message: "كلمة المرور يجب أن تكون 8 خانات على الأقل" } })} />
            <Input label="رقم الهاتف (اختياري)" type="tel" inputMode="tel" dir="ltr" className="text-left" placeholder="0551234567" autoComplete="tel" error={registerForm.formState.errors.phone?.message} {...registerForm.register("phone", { pattern: { value: PHONE_REGEX, message: "رقم هاتف جزائري غير صالح (مثال: 0551234567)" } })} />
            {error && <p className="text-sm font-semibold text-red-600" role="alert">{error}</p>}
            <Button type="submit" className="min-h-[48px] w-full" loading={submitting}>
              إنشاء الحساب
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
