import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/States";
import { useToast } from "../components/ui/Toast";
import { useAuth } from "../context/AuthContext";

interface FormValues {
  currentPassword: string;
  email: string;
  newPassword: string;
  confirmPassword: string;
}

export default function AccountSettings() {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me-account"],
    queryFn: async () => (await api.get("/auth/me")).data.data,
  });
  const { showToast } = useToast();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>();

  async function onSubmit(values: FormValues) {
    const payload: Record<string, string> = { currentPassword: values.currentPassword };
    if (values.email && values.email !== me?.email) payload.email = values.email;
    if (values.newPassword) payload.newPassword = values.newPassword;

    if (!payload.email && !payload.newPassword) {
      showToast("لا يوجد أي تغيير لحفظه.", "error");
      return;
    }

    setSaving(true);
    try {
      await api.patch("/auth/account", payload);
      if (payload.newPassword) {
        // تغيير كلمة المرور يُبطل الجلسات الحالية — نُخرج المستخدم ليدخل ببياناته الجديدة.
        showToast("تم تحديث بيانات الحساب. الرجاء تسجيل الدخول من جديد.", "success");
        await logout();
        navigate("/login");
      } else {
        showToast("تم تحديث البريد الإلكتروني.", "success");
      }
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر تحديث بيانات الحساب."), "error");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">إعدادات الحساب</h1>
        <p className="mt-1 text-sm text-slate-500">
          غيّر بريدك الإلكتروني أو كلمة مرورك. كلمة المرور الحالية مطلوبة لتأكيد هويتك.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
        <div>
          <label className="label">البريد الإلكتروني</label>
          <input
            className="input"
            type="email"
            defaultValue={me?.email ?? ""}
            {...register("email", { required: "مطلوب" })}
          />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
        </div>

        <hr className="border-slate-200" />

        <Input
          label="كلمة المرور الحالية"
          type="password"
          placeholder="••••••••"
          error={errors.currentPassword?.message}
          {...register("currentPassword", { required: "مطلوب لتأكيد التغيير" })}
        />

        <Input
          label="كلمة المرور الجديدة (اتركها فارغة إن لم ترد تغييرها)"
          type="password"
          placeholder="••••••••"
          error={errors.newPassword?.message}
          {...register("newPassword", {
            minLength: { value: 8, message: "8 خانات على الأقل" },
          })}
        />

        <Input
          label="تأكيد كلمة المرور الجديدة"
          type="password"
          placeholder="••••••••"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword", {
            validate: (v) => !watch("newPassword") || v === watch("newPassword") || "كلمتا المرور غير متطابقتين",
          })}
        />

        <p className="text-xs text-slate-500">
          عند تغيير كلمة المرور سيتم إنهاء كل الجلسات المفتوحة، وستحتاج لتسجيل الدخول من جديد.
        </p>

        <Button type="submit" loading={saving}>
          حفظ التغييرات
        </Button>
      </form>
    </div>
  );
}
