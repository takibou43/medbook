import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Stethoscope } from "lucide-react";
import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { apiErrorMessage } from "../lib/api";

// عنوان موقع الأطباء المنفصل (لوحة تحكم الطبيب) — يُضبط عبر متغير بيئة عند النشر.
const DOCTOR_SITE_URL = import.meta.env.VITE_DOCTOR_SITE_URL ?? "/login";

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
      if (user.role === "ADMIN") {
        showToast("تم تسجيل الدخول بنجاح.", "success");
        navigate("/admin");
      } else if (user.role === "DOCTOR") {
        showToast("حسابات الأطباء تُدار من موقع الأطباء المخصص.", "info");
        await logout();
        window.location.href = DOCTOR_SITE_URL;
      } else {
        // حسابات مرضى قديمة (قبل إلغاء تسجيل الدخول للمرضى) — لا توجد لوحة تحكم لهم بعد الآن.
        showToast("لم يعد الدخول متاحًا للمرضى — يمكنك الحجز مباشرة بدون حساب.", "info");
        await logout();
        navigate("/book");
      }
    } catch (err) {
      showToast(apiErrorMessage(err, "بيانات الدخول غير صحيحة."), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-app flex min-h-[80vh] items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-2 rounded-2xl bg-primary-600 p-2.5 text-white">
            <Stethoscope className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">تسجيل دخول الإدارة</h1>
          <p className="mt-1 text-center text-sm text-slate-500">
            هذا الدخول مخصص لفريق الإدارة. أطباء يبحثون عن لوحة التحكم؟{" "}
            <a href={DOCTOR_SITE_URL} className="font-semibold text-primary-700 hover:underline">
              موقع الأطباء من هنا
            </a>
            .
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
          <Input label="البريد الإلكتروني" type="email" placeholder="you@example.com" error={errors.email?.message} {...register("email", { required: "البريد الإلكتروني مطلوب" })} />
          <Input label="كلمة المرور" type="password" placeholder="••••••••" error={errors.password?.message} {...register("password", { required: "كلمة المرور مطلوبة" })} />
          <Button type="submit" className="w-full" loading={loading}>
            تسجيل الدخول
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          هل أنت مريض؟ لا حاجة لحساب —{" "}
          <Link to="/book" className="font-semibold text-primary-700 hover:underline">
            احجز موعدك مباشرة من هنا
          </Link>
        </p>
      </div>
    </div>
  );
}
