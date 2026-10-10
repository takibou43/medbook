import { useLanguage } from "../i18n/LanguageRoot";
import { t, catalogName } from "../i18n/locale.ts";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { Input, Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { Logo } from "../components/ui/Logo";
import { apiErrorMessage } from "../lib/api";
import { portalUrl } from "../lib/portalSwitch";
import { clinicInviteReturnPath } from "../lib/clinicInvite";

interface ApplyForm {
  firstName: string;
  lastName: string;
  specialtyId: string;
  wilayaId: string;
  cityId: string;
  yearsExperience: number;
  referralCode: string;
  password: string;
}

const PATIENT_SITE = import.meta.env.VITE_MAIN_SITE_URL ?? "https://medbook-alpha.vercel.app";

/**
 * طلب تسجيل كطبيب من حساب المريض نفسه (بلا حساب ثانٍ): البريد والهاتف وكلمة المرور هي نفسها.
 * يُنشأ ملف طبيب «قيد المراجعة» فقط؛ لا ظهور للمرضى ولا اعتماد قبل موافقة الإدارة، وتبقى وظائف المريض كما هي.
 */
export default function ApplyDoctor() {
  useLanguage();
  const { user, applyAsDoctor, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const [loading, setLoading] = useState(false);
  const [selectedWilaya, setSelectedWilaya] = useState("");
  const form = useForm<ApplyForm>({
    defaultValues: { firstName: user?.patient?.firstName ?? "", lastName: user?.patient?.lastName ?? "" } as Partial<ApplyForm>,
  });
  const cities = wilayas?.find((w) => w.id === selectedWilaya)?.cities ?? [];

  async function onSubmit(values: ApplyForm) {
    setLoading(true);
    try {
      const referralCode = (values.referralCode ?? "").trim();
      await applyAsDoctor({
        password: values.password,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        specialtyId: values.specialtyId,
        wilayaId: values.wilayaId,
        cityId: values.cityId,
        yearsExperience: Number(values.yearsExperience) || 0,
        ...(referralCode ? { referralCode } : {}),
      });
      showToast(t("تم استلام طلبك كطبيب. ملفك قيد المراجعة من الإدارة قبل الظهور للمرضى."), "success");
      navigate(clinicInviteReturnPath(location.state?.returnTo) ?? "/");
    } catch (err) {
      if ((err as any)?.response?.data?.details?.field === "referralCode") {
        form.setError("referralCode", { message: apiErrorMessage(err) }, { shouldFocus: true });
      } else {
        showToast(apiErrorMessage(err, t("تعذّر تقديم الطلب.")), "error");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="container-app flex min-h-screen items-center justify-center py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center">
          <Logo className="mb-2 h-14 w-14" />
          <h1 className="text-xl font-extrabold text-slate-900">{t("قدّم كطبيب من حسابك الحالي")}</h1>
          <p className="mt-2 text-center text-sm leading-6 text-slate-600">{t("أنت مسجّل الدخول بحساب مريض (")}{user?.email}{t("). سيُضاف ملف الطبيب إلى الحساب نفسه بالبريد والهاتف نفسيهما، ويبقى استخدامك كمريض كما هو. ")}</p>
          <p className="mt-1 text-center text-xs leading-5 text-slate-500">{t("الطلب لا يعني الاعتماد: يخضع ملفك لمراجعة الإدارة قبل الظهور للمرضى وقبل أي صلاحية تعتمد على التوثيق. ")}</p>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="card space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t("الاسم")} error={form.formState.errors.firstName?.message} {...form.register("firstName", { required: t("مطلوب"), minLength: { value: 2, message: t("قصير جدًا") } })} />
            <Input label={t("اللقب")} error={form.formState.errors.lastName?.message} {...form.register("lastName", { required: t("مطلوب"), minLength: { value: 2, message: t("قصير جدًا") } })} />
          </div>
          <Select label={t("التخصص")} error={form.formState.errors.specialtyId?.message} {...form.register("specialtyId", { required: t("مطلوب") })}>
            <option value="">{t("اختر التخصص")}</option>
            {specialties?.map((s) => (
              <option key={s.id} value={s.id}>{catalogName(s)}</option>
            ))}
          </Select>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label={t("الولاية")} error={form.formState.errors.wilayaId?.message} {...form.register("wilayaId", { required: t("مطلوب"), onChange: (e) => { setSelectedWilaya(e.target.value); form.setValue("cityId", ""); } })}>
              <option value="">{t("اختر")}</option>
              {wilayas?.map((w) => (
                <option key={w.id} value={w.id}>{catalogName(w)}</option>
              ))}
            </Select>
            <Select label={t("المدينة")} error={form.formState.errors.cityId?.message} {...form.register("cityId", { required: t("مطلوب") })}>
              <option value="">{t("اختر")}</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.nameAr}</option>
              ))}
            </Select>
          </div>
          <Input label={t("سنوات الخبرة")} type="number" min={0} {...form.register("yearsExperience")} />
          <Input
            label={t("كود دعوة من زميل (اختياري)")}
            placeholder="MB-XXXXXXXX"
            dir="ltr"
            autoCapitalize="characters"
            maxLength={20}
            error={form.formState.errors.referralCode?.message as string | undefined}
            {...form.register("referralCode")}
          />
          <Input
            label={t("كلمة مرور حسابك الحالية (للتأكيد)")}
            type="password"
            autoComplete="current-password"
            error={form.formState.errors.password?.message}
            {...form.register("password", { required: t("مطلوبة لتأكيد الطلب") })}
          />
          <Button type="submit" className="min-h-[48px] w-full" loading={loading}>{t("إرسال طلب التسجيل كطبيب ")}</Button>
        </form>

        <div className="mt-4 flex flex-col items-center gap-2 text-sm">
          <a href={portalUrl(PATIENT_SITE, "/account")} className="font-semibold text-primary-700 hover:underline">{t("العودة إلى واجهة المرضى ")}</a>
          <button type="button" onClick={handleLogout} className="text-slate-500 hover:underline">{t("تسجيل الخروج ")}</button>
        </div>
      </div>
    </div>
  );
}
