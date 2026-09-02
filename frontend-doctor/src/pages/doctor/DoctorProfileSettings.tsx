import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Input, Textarea } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";

interface FormValues {
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
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, reset } = useForm<FormValues>();

  useEffect(() => {
    if (me?.doctor) {
      reset({
        bio: me.doctor.bio ?? "",
        yearsExperience: me.doctor.yearsExperience,
        consultationFee: me.doctor.consultationFee ?? 0,
        phone: me.doctor.phone ?? "",
        address: me.doctor.address ?? "",
      });
    }
  }, [me, reset]);

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
        <div>
          <label className="label">التخصص</label>
          <div className="input flex items-center bg-slate-50 text-slate-600">{me?.doctor?.specialty?.nameAr ?? "—"}</div>
          <p className="mt-1 text-xs text-slate-400">لتغيير التخصص، الرجاء التواصل مع الإدارة.</p>
        </div>
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
