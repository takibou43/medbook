import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, apiErrorMessage } from "../lib/api";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Spinner, ErrorState } from "../components/ui/States";
import { useToast } from "../components/ui/Toast";
import { Logo } from "../components/ui/Logo";

interface InvitePreview {
  email: string;
  doctorName: string;
  clinicName: string | null;
}

interface FormValues {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

export default function AssistantAcceptInvite() {
  const { token = "" } = useParams<{ token: string }>();
  const { registerAssistant } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  // فحص صلاحية الدعوة قبل عرض النموذج — نفس الرمز يُتحقق منه مجددًا في الخادم عند
  // الإرسال، لذا لا خطر أمني هنا؛ الهدف فقط عرض اسم الطبيب وتفادي نموذج لدعوة ملغاة.
  const {
    data: preview,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["assistant-invite", token],
    queryFn: async () => (await api.get<{ data: InvitePreview }>(`/assistants/invite/${token}`)).data.data,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>();

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      await registerAssistant({
        token,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
      });
      showToast("تم إنشاء حسابك بنجاح.", "success");
      navigate("/");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إنشاء الحساب. قد يكون رابط الدعوة غير صالح."), "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container-app flex min-h-screen items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Logo className="mb-2 h-14 w-14" />
          <h1 className="text-xl font-extrabold text-slate-900">إنشاء حساب مساعد</h1>
        </div>

        {isLoading && <Spinner label="جارٍ التحقق من رابط الدعوة..." />}

        {isError && (
          <ErrorState message={apiErrorMessage(error, "رابط الدعوة غير صالح أو منتهي الصلاحية.")} />
        )}

        {preview && (
          <>
            <div className="card mb-4 flex items-center gap-3 border-primary-200 bg-primary-50 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
                <UserCog className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-slate-600">أنت مدعوّ للانضمام كمساعد لدى</p>
                <p className="truncate font-bold text-slate-900">
                  د. {preview.doctorName}
                  {preview.clinicName ? ` — ${preview.clinicName}` : ""}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
              <Input label="البريد الإلكتروني" type="email" value={preview.email} disabled readOnly />

              <div className="grid grid-cols-2 gap-3">
                <Input label="الاسم" error={errors.firstName?.message} {...register("firstName", { required: "مطلوب" })} />
                <Input label="اللقب" error={errors.lastName?.message} {...register("lastName", { required: "مطلوب" })} />
              </div>

              <Input
                label="كلمة المرور"
                type="password"
                placeholder="••••••••"
                error={errors.password?.message}
                {...register("password", { required: "مطلوب", minLength: { value: 8, message: "8 خانات على الأقل" } })}
              />
              <Input
                label="تأكيد كلمة المرور"
                type="password"
                placeholder="••••••••"
                error={errors.confirmPassword?.message}
                {...register("confirmPassword", {
                  validate: (v) => v === watch("password") || "كلمتا المرور غير متطابقتين",
                })}
              />

              <Button type="submit" className="w-full" loading={submitting}>
                إنشاء الحساب
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
