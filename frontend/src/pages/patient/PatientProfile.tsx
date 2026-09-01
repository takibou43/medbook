import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Input, Select } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { useWilayas } from "../../hooks/useCatalog";

interface FormValues {
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  cityId: string;
}

export default function PatientProfile() {
  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ["patient-profile"],
    queryFn: async () => (await api.get("/patient/profile")).data.data,
  });
  const { data: wilayas } = useWilayas();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, reset } = useForm<FormValues>();

  useEffect(() => {
    if (profile) {
      reset({
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.user?.phone ?? "",
        gender: profile.gender ?? "",
        cityId: profile.cityId ?? "",
      });
    }
  }, [profile, reset]);

  async function onSubmit(values: FormValues) {
    setSaving(true);
    try {
      await api.patch("/patient/profile", values);
      showToast("تم تحديث الملف الشخصي.", "success");
      refetch();
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Spinner />;

  const allCities = wilayas?.flatMap((w) => w.cities?.map((c) => ({ ...c, wilayaName: w.nameAr })) ?? []) ?? [];

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">الملف الشخصي</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
        <Input label="البريد الإلكتروني" value={profile?.user?.email ?? ""} disabled />
        <div className="grid grid-cols-2 gap-3">
          <Input label="الاسم" {...register("firstName", { required: true })} />
          <Input label="اللقب" {...register("lastName", { required: true })} />
        </div>
        <Input label="رقم الهاتف" {...register("phone")} />
        <Select label="الجنس" {...register("gender")}>
          <option value="">غير محدد</option>
          <option value="MALE">ذكر</option>
          <option value="FEMALE">أنثى</option>
        </Select>
        <Select label="المدينة" {...register("cityId")}>
          <option value="">اختر المدينة</option>
          {allCities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameAr} — {c.wilayaName}
            </option>
          ))}
        </Select>
        <Button type="submit" loading={saving}>
          حفظ التغييرات
        </Button>
      </form>
    </div>
  );
}
