import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Input, Select, Textarea } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { useSpecialties } from "../../hooks/useCatalog";

interface FormValues {
  specialtyId: string;
  bio: string;
  yearsExperience: number;
  consultationFee: number;
  phone: string;
  address: string;
}

export default function DoctorProfileSettings() {
  const { data: me, isLoading, refetch } = useQuery({
    queryKey: ["me-doctor-profile"],
    queryFn: async () => (await api.get("/auth/me")).data.data,
  });
  const { data: specialties } = useSpecialties();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, reset } = useForm<FormValues>();

  useEffect(() => {
    // ننتظر تحميل قائمة التخصصات أيضًا: إن نُفِّذ reset() قبل رسم خيارات <select>،
    // لن يستطيع المتصفح تحديد القيمة الحالية لأن الخيار المطابق لن يكون موجودًا بعد.
    if (me?.doctor && specialties) {
      reset({
        specialtyId: me.doctor.specialtyId ?? "",
        bio: me.doctor.bio ?? "",
        yearsExperience: me.doctor.yearsExperience,
        consultationFee: me.doctor.consultationFee ?? 0,
        phone: me.doctor.phone ?? "",
        address: me.doctor.address ?? "",
      });
    }
  }, [me, specialties, reset]);

  async function onSubmit(values: FormValues) {
    setSaving(true);
    try {
      await api.patch("/doctor/profile", { ...values, yearsExperience: Number(values.yearsExperience), consultationFee: Number(values.consultationFee) });
      showToast("تم تحديث ملفك المهني.", "success");
      refetch();
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">ملفي المهني</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
        <Select label="التخصص" {...register("specialtyId", { required: "مطلوب" })}>
          <option value="">اختر التخصص</option>
          {specialties?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameAr}
            </option>
          ))}
        </Select>
        <Textarea label="نبذة تعريفية" {...register("bio")} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="سنوات الخبرة" type="number" {...register("yearsExperience")} />
          <Input label="سعر الاستشارة (دج)" type="number" {...register("consultationFee")} />
        </div>
        <Input label="رقم الهاتف" {...register("phone")} />
        <Input label="العنوان" {...register("address")} />
        <Button type="submit" loading={saving}>
          حفظ التغييرات
        </Button>
      </form>
    </div>
  );
}
