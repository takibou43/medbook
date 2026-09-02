import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { Input, Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { Logo } from "../components/ui/Logo";
import { apiErrorMessage } from "../lib/api";

interface DoctorForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  gender: string;
  specialtyId: string;
  wilayaId: string;
  cityId: string;
  yearsExperience: number;
  [key: string]: unknown;
}

export default function Register() {
  const { registerDoctor } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const [loading, setLoading] = useState(false);
  const [selectedWilaya, setSelectedWilaya] = useState("");

  const doctorForm = useForm<DoctorForm>();

  async function onSubmitDoctor(values: DoctorForm) {
    setLoading(true);
    try {
      await registerDoctor({ ...values, yearsExperience: Number(values.yearsExperience) });
      showToast("تم إنشاء الحساب! ملفك قيد المراجعة من الإدارة قبل الظهور للمرضى.", "success");
      navigate("/");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إنشاء الحساب."), "error");
    } finally {
      setLoading(false);
    }
  }

  const cities = wilayas?.find((w) => w.id === selectedWilaya)?.cities ?? [];

  return (
    <div className="container-app flex min-h-screen items-center justify-center py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center">
          <Logo className="mb-2 h-14 w-14" />
          <h1 className="text-xl font-extrabold text-slate-900">انضم كطبيب في MedBook</h1>
          <p className="mt-1 text-center text-sm text-slate-500">
            مرضاك يحجزون معك مباشرة بدون حاجة لإنشاء حساب — أنت فقط من يحتاج تسجيل الدخول لإدارة مواعيدك.
          </p>
        </div>

        <form onSubmit={doctorForm.handleSubmit(onSubmitDoctor)} className="card space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <Input label="الاسم" error={doctorForm.formState.errors.firstName?.message} {...doctorForm.register("firstName", { required: "مطلوب" })} />
            <Input label="اللقب" error={doctorForm.formState.errors.lastName?.message} {...doctorForm.register("lastName", { required: "مطلوب" })} />
          </div>
          <Input label="البريد الإلكتروني" type="email" error={doctorForm.formState.errors.email?.message} {...doctorForm.register("email", { required: "مطلوب" })} />
          <Input label="رقم الهاتف" error={doctorForm.formState.errors.phone?.message} {...doctorForm.register("phone")} />
          <Select label="التخصص" error={doctorForm.formState.errors.specialtyId?.message} {...doctorForm.register("specialtyId", { required: "مطلوب" })}>
            <option value="">اختر التخصص</option>
            {specialties?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameAr}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="الولاية"
              error={doctorForm.formState.errors.wilayaId?.message}
              {...doctorForm.register("wilayaId", { required: "مطلوب", onChange: (e) => setSelectedWilaya(e.target.value) })}
            >
              <option value="">اختر</option>
              {wilayas?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nameAr}
                </option>
              ))}
            </Select>
            <Select label="المدينة" error={doctorForm.formState.errors.cityId?.message} {...doctorForm.register("cityId", { required: "مطلوب" })}>
              <option value="">اختر</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </Select>
          </div>
          <Input label="سنوات الخبرة" type="number" min={0} {...doctorForm.register("yearsExperience")} />
          <Input
            label="كلمة المرور"
            type="password"
            error={doctorForm.formState.errors.password?.message}
            {...doctorForm.register("password", { required: "مطلوب", minLength: { value: 8, message: "8 خانات على الأقل" } })}
          />
          <p className="text-xs text-slate-500">ملاحظة: يخضع حساب الطبيب لمراجعة الإدارة قبل الظهور للمرضى في نتائج البحث.</p>
          <Button type="submit" className="w-full" loading={loading}>
            إنشاء الحساب
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          هل لديك حساب بالفعل؟{" "}
          <a href="/login" className="font-semibold text-primary-700 hover:underline">
            تسجيل الدخول
          </a>
        </p>
      </div>
    </div>
  );
}
