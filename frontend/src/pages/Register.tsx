import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Stethoscope } from "lucide-react";
import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { Input, Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { apiErrorMessage } from "../lib/api";
import clsx from "clsx";

interface PatientForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  gender: string;
  [key: string]: unknown;
}

interface DoctorForm extends PatientForm {
  specialtyId: string;
  wilayaId: string;
  cityId: string;
  yearsExperience: number;
}

export default function Register() {
  const [role, setRole] = useState<"PATIENT" | "DOCTOR">("PATIENT");
  const { registerPatient, registerDoctor } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const [loading, setLoading] = useState(false);
  const [selectedWilaya, setSelectedWilaya] = useState("");

  const patientForm = useForm<PatientForm>();
  const doctorForm = useForm<DoctorForm>();

  async function onSubmitPatient(values: PatientForm) {
    setLoading(true);
    try {
      await registerPatient(values);
      showToast("تم إنشاء حسابك بنجاح!", "success");
      navigate("/patient");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إنشاء الحساب."), "error");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitDoctor(values: DoctorForm) {
    setLoading(true);
    try {
      await registerDoctor({ ...values, yearsExperience: Number(values.yearsExperience) });
      showToast("تم إنشاء الحساب! ملفك قيد المراجعة من الإدارة قبل الظهور للمرضى.", "success");
      navigate("/doctor");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إنشاء الحساب."), "error");
    } finally {
      setLoading(false);
    }
  }

  const cities = wilayas?.find((w) => w.id === selectedWilaya)?.cities ?? [];

  return (
    <div className="container-app flex min-h-[80vh] items-center justify-center py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-2 rounded-2xl bg-primary-600 p-2.5 text-white">
            <Stethoscope className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">إنشاء حساب في MedBook</h1>
        </div>

        <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setRole("PATIENT")}
            className={clsx("flex-1 rounded-lg py-2 text-sm font-semibold transition", role === "PATIENT" ? "bg-white shadow-sm text-primary-700" : "text-slate-500")}
          >
            مريض
          </button>
          <button
            onClick={() => setRole("DOCTOR")}
            className={clsx("flex-1 rounded-lg py-2 text-sm font-semibold transition", role === "DOCTOR" ? "bg-white shadow-sm text-primary-700" : "text-slate-500")}
          >
            طبيب
          </button>
        </div>

        {role === "PATIENT" ? (
          <form onSubmit={patientForm.handleSubmit(onSubmitPatient)} className="card space-y-4 p-6">
            <div className="grid grid-cols-2 gap-3">
              <Input label="الاسم" error={patientForm.formState.errors.firstName?.message} {...patientForm.register("firstName", { required: "مطلوب" })} />
              <Input label="اللقب" error={patientForm.formState.errors.lastName?.message} {...patientForm.register("lastName", { required: "مطلوب" })} />
            </div>
            <Input label="البريد الإلكتروني" type="email" error={patientForm.formState.errors.email?.message} {...patientForm.register("email", { required: "مطلوب" })} />
            <Input label="رقم الهاتف" error={patientForm.formState.errors.phone?.message} {...patientForm.register("phone")} />
            <Select label="الجنس" {...patientForm.register("gender")}>
              <option value="">اختر</option>
              <option value="MALE">ذكر</option>
              <option value="FEMALE">أنثى</option>
            </Select>
            <Input
              label="كلمة المرور"
              type="password"
              error={patientForm.formState.errors.password?.message}
              {...patientForm.register("password", { required: "مطلوب", minLength: { value: 8, message: "8 خانات على الأقل" } })}
            />
            <Button type="submit" className="w-full" loading={loading}>
              إنشاء الحساب
            </Button>
          </form>
        ) : (
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
        )}

        <p className="mt-4 text-center text-sm text-slate-600">
          لديك حساب بالفعل؟{" "}
          <Link to="/login" className="font-semibold text-primary-700 hover:underline">
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
