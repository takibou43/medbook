import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { LocateFixed, MapPin } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Input, Select, Textarea } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { useSpecialties, useWilayas } from "../../hooks/useCatalog";

interface FormValues {
  specialtyId: string;
  wilayaId: string;
  cityId: string;
  slotDurationMin: number;
  bio: string;
  yearsExperience: number;
  consultationFee: number;
  phone: string;
  address: string;
  latitude?: number;
  longitude?: number;
}

const SLOT_OPTIONS = [5, 7, 10, 15, 20, 30, 45, 60];

export default function DoctorProfileSettings() {
  const { data: me, isLoading, refetch } = useQuery({
    queryKey: ["me-doctor-profile"],
    queryFn: async () => (await api.get("/auth/me")).data.data,
  });
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [selectedWilaya, setSelectedWilaya] = useState("");
  const [locating, setLocating] = useState(false);
  const { register, handleSubmit, reset, watch, setValue } = useForm<FormValues>();

  const watchedWilaya = watch("wilayaId");
  const watchedLat = watch("latitude");
  const watchedLng = watch("longitude");

  // يضبط الطبيب موقع عيادته بنفسه من هاتفه/حاسوبه وهو فيها فعليًا — لا جيوكودينغ ولا
  // خدمة مدفوعة، فقط Browser Geolocation. يُستعمل بعدها لحساب المسافة للمرضى وفتح الملاحة.
  function useMyLocation() {
    if (!navigator.geolocation) {
      showToast("متصفحك لا يدعم تحديد الموقع.", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setValue("latitude", pos.coords.latitude, { shouldValidate: true });
        setValue("longitude", pos.coords.longitude, { shouldValidate: true });
        showToast("تم تحديد موقع العيادة — لا تنسَ حفظ التغييرات.", "success");
      },
      () => {
        setLocating(false);
        showToast("تعذّر الوصول إلى موقعك. تأكد من إذن الموقع في المتصفح.", "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  useEffect(() => {
    // ننتظر تحميل قائمتي التخصصات والولايات أيضًا: إن نُفِّذ reset() قبل رسم خيارات <select>،
    // لن يستطيع المتصفح تحديد القيمة الحالية لأن الخيار المطابق لن يكون موجودًا بعد.
    if (me?.doctor && specialties && wilayas) {
      reset({
        specialtyId: me.doctor.specialtyId ?? "",
        wilayaId: me.doctor.wilayaId ?? "",
        cityId: me.doctor.cityId ?? "",
        slotDurationMin: me.doctor.slotDurationMin ?? 7,
        bio: me.doctor.bio ?? "",
        yearsExperience: me.doctor.yearsExperience,
        consultationFee: me.doctor.consultationFee ?? 0,
        phone: me.doctor.phone ?? "",
        address: me.doctor.address ?? "",
        latitude: me.doctor.latitude ?? undefined,
        longitude: me.doctor.longitude ?? undefined,
      });
      setSelectedWilaya(me.doctor.wilayaId ?? "");
    }
  }, [me, specialties, wilayas, reset]);

  useEffect(() => {
    if (watchedWilaya) setSelectedWilaya(watchedWilaya);
  }, [watchedWilaya]);

  const cities = wilayas?.find((w) => w.id === selectedWilaya)?.cities ?? [];

  async function onSubmit(values: FormValues) {
    setSaving(true);
    try {
      await api.patch("/doctor/profile", {
        ...values,
        yearsExperience: Number(values.yearsExperience),
        consultationFee: Number(values.consultationFee),
        slotDurationMin: Number(values.slotDurationMin),
      });
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
        <div className="grid grid-cols-2 gap-3">
          <Select label="الولاية" {...register("wilayaId", { required: "مطلوب" })}>
            <option value="">اختر</option>
            {wilayas?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nameAr}
              </option>
            ))}
          </Select>
          <Select label="المدينة" {...register("cityId", { required: "مطلوب" })}>
            <option value="">اختر</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameAr}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Select label="مدة الجلسة الواحدة" {...register("slotDurationMin", { required: "مطلوب" })}>
            {SLOT_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} دقيقة
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-slate-400">
            على أساسها يوزّع الموقع أدوار المرضى تلقائيًا: كل مريض يأخذ الدور الذي يلي سابقه بهذه المدة.
          </p>
        </div>

        <Textarea label="نبذة تعريفية" {...register("bio")} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="سنوات الخبرة" type="number" {...register("yearsExperience")} />
          <Input label="سعر الاستشارة (دج)" type="number" {...register("consultationFee")} />
        </div>
        <Input label="رقم الهاتف" {...register("phone")} />
        <Input label="العنوان" {...register("address")} />

        <div>
          <p className="label flex items-center gap-1.5">
            <MapPin className="h-4 w-4" /> موقع العيادة (لعرض المسافة للمرضى وفتح الملاحة)
          </p>
          <input type="hidden" {...register("latitude")} />
          <input type="hidden" {...register("longitude")} />
          <button type="button" onClick={useMyLocation} disabled={locating} className="btn-outline mt-1 disabled:opacity-60">
            <LocateFixed className="h-4 w-4" /> {locating ? "جارٍ تحديد الموقع..." : "استخدم موقعي الحالي"}
          </button>
          <p className="mt-1 text-xs text-slate-400">
            {watchedLat != null && watchedLng != null
              ? "تم ضبط موقع العيادة. اضغط الزر مجددًا لتحديثه إن انتقلت لعيادة أخرى."
              : "لم يُضبط موقع العيادة بعد — بدونه لن تظهر المسافة أو زر الملاحة للمرضى."}
          </p>
        </div>

        <Button type="submit" loading={saving}>
          حفظ التغييرات
        </Button>
      </form>
    </div>
  );
}
