import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Stethoscope } from "lucide-react";
import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { apiErrorMessage } from "../lib/api";

// عنوان الموقع الرئيسي (حجز المرضى + إنشاء حساب طبيب جديد) — يُضبط عبر متغير بيئة عند النشر.
const MAIN_SITE_URL = import.meta.env.VITE_MAIN_SITE_URL ?? "/";

interface FormValues {
  email: string;
  password: string;
}

export default function Login() {
  const { login, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>();

  async function onSubmit(values: FormValues) {
    setLoading(true);
    try {
      const user = await login(values.email, values.password);
      if (user.role !== "DOCTOR") {
        showToast("هذا الموقع مخصص لحسابات الأطباء فقط.", "error");
        await logout();
        return;
      }
      showToast("تم تسجيل الدخول بنجاح.", "success");
      navigate("/");
    } catch (err) {
      showToast(apiErrorMessage(err, "بيانات الدخول غير صحيحة."), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-app flex min-h-screen items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-2 rounded-2xl bg-primary-600 p-2.5 text-white">
            <Stethoscope className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">تسجيل دخول الأطباء</h1>
          <p className="mt-1 text-center text-sm text-slate-500">لوحة تحكم الطبيب — إدارة مواعيدك وجدول عملك ومرضاك.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
          <Input label="البريد الإلكتروني" type="email" placeholder="you@example.com" error={errors.email?.message} {...register("email", { required: "البريد الإلكتروني مطلوب" })} />
          <Input label="كلمة المرور" type="password" placeholder="••••••••" error={errors.password?.message} {...register("password", { required: "كلمة المرور مطلوبة" })} />
          <Button type="submit" className="w-full" loading={loading}>
            تسجيل الدخول
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          ليس لديك حساب طبيب؟{" "}
          <a href={`${MAIN_SITE_URL}register`} className="font-semibold text-primary-700 hover:underline">
            انضم كطبيب من الموقع الرئيسي
          </a>
        </p>
      </div>
    </div>
  );
}
