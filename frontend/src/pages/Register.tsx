import { useState } from "react";
import { Link } from "react-router-dom";
import { Stethoscope } from "lucide-react";
import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { Input, Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { apiErrorMessage } from "../lib/api";

// عنوان موقع الأطباء المنفصل (لوحة تحكم الطبيب) — يُضبط عبر متغير بيئة عند النشر.
const DOCTOR_SITE_URL = import.meta.env.VITE_DOCTOR_SITE_URL ?? "/login";

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
  // توقيع فهرسة عام حتى تكون هذه الواجهة متوافقة مع Record<string, unknown> الذي يتوقعه registerDoctor في AuthContext.
  [key: string]: unknown;
}

export default function Register() {
  const { registerDoctor } = useAuth();
  const { showToast } = useToast();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [selectedWilaya, setSelectedWilaya] = useState("");

  const doctorForm = useForm<DoctorForm>();

  async function onSubmitDoctor(values: DoctorForm) {
    setLoading(true);
    try {
      await registerDoctor({ ...values, yearsExperience: Number(values.yearsExperience) });
      showToast("تم إنشاء الحساب! ملفك قيد المراجعة من الإدارة قبل الظهور للمرضى.", "success");
      setDone(true);
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إنشاء الحساب."), "error");
    } finally {
      setLoading(false);
    }
  }

  const cities = wilayas?.find((w) => w.id === selectedWilaya)?.cities ?? [];

  if (done) {
    return (
      <div className="container-app flex min-h-[80vh] items-center justify-center py-10">
        <div className="card w-full max-w-md p-6 text-center">
          <div className="mx-auto mb-3 w-fit rounded-2xl bg-primary-600 p-2.5 text-white">
            <Stethoscope className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-extrabold text-slate-900">تم إنشاء حسابك بنجاح!</h1>
          <p className="mt-2 text-sm text-slate-600">
            ملفك المهني قيد المراجعة من الإدارة. بعد التحقق، يمكنك تسجيل الدخول إلى لوحة تحكم الطبيب من الموقع المخصص للأطباء.
          </p>
          <a href={DOCTOR_SITE_URL} className="btn-primary mt-5 inline-flex">
            الانتقال إلى موقع الأطباء
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="container-app flex min-h-[80vh] items-center justify-center py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-2 rounded-2xl bg-primary-600 p-2.5 text-white">
            <Stethoscope className="h-6 w-6" />
          </div>
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
          هل أنت طبيب ولديك حساب بالفعل؟{" "}
          <a href={DOCTOR_SITE_URL} className="font-semibold text-primary-700 hover:underline">
            تسجيل الدخول إلى موقع الأطباء
          </a>
        </p>
        <p className="mt-2 text-center text-xs text-slate-400">
          هل أنت مريض؟ لا حاجة لحساب —{" "}
          <Link to="/book" className="font-semibold text-primary-700 hover:underline">
            احجز موعدك مباشرة من هنا
          </Link>
        </p>
      </div>
    </div>
  );
}
