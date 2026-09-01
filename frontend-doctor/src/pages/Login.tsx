import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Stethoscope } from "lucide-react";
import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { apiErrorMessage } from "../lib/api";

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
      if (user.role !== "DOCTOR" && user.role !== "ADMIN") {
        showToast("هذا الموقع مخصص لحسابات الأطباء والإدارة فقط.", "error");
        await logout();
        return;
      }
      showToast("تم تسجيل الدخول بنجاح.", "success");
      navigate(user.role === "ADMIN" ? "/admin" : "/");
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
          <h1 className="text-xl font-extrabold text-slate-900">تسجيل دخول الأطباء والإدارة</h1>
          <p className="mt-1 text-center text-sm text-slate-500">لوحة تحكم الطبيب والإدارة — إدارة المواعيد وجدول العمل والمرضى والمنصة.</p>
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
          <a href="/register" className="font-semibold text-primary-700 hover:underline">
            انضم كطبيب
          </a>
        </p>
      </div>
    </div>
  );
}
