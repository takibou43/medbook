import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
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
import { formatDzd, formatPercent } from "../../lib/doctorUi";
import { SpecialtyInput } from "../../components/SpecialtyInput";

interface FormValues {
  specialtyName: string;
  wilayaId: string;
  cityId: string;
  bio: string;
  yearsExperience: number;
  consultationFee: number;
  phone: string;
  address: string;
  latitude?: number;
  longitude?: number;
}


export default function DoctorProfileSettings() {
  useLanguage();
  const { data: me, isLoading, refetch } = useQuery({
    queryKey: ["me-doctor-profile"],
    queryFn: async () => (await api.get("/auth/me")).data.data,
  });
  // طبيب في عيادة لها مدير: سعر الموعد والنسبة يحددهما المدير، فتُعرضان للقراءة فقط (شروطه هو وحده).
  const { data: clinicTerms } = useQuery({
    queryKey: ["my-clinic-terms"],
    queryFn: async () => (await api.get<{ data: { inClinic: boolean; clinicName?: string; appointmentPriceDzd?: number | null; doctorSharePercent?: number | null; clinicSharePercent?: number | null } }>("/doctor/clinic-terms")).data.data,
    retry: false,
  });
  const priceLocked = clinicTerms?.inClinic === true;
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [selectedWilaya, setSelectedWilaya] = useState("");
  const [locating, setLocating] = useState(false);
  const { register, handleSubmit, reset, watch, setValue, formState: { dirtyFields } } = useForm<FormValues>();

  const specialtyName = watch("specialtyName") ?? "";
  const watchedWilaya = watch("wilayaId");
  const watchedLat = watch("latitude");
  const watchedLng = watch("longitude");

  // يضبط الطبيب موقع عيادته بنفسه من هاتفه/حاسوبه وهو فيها فعليًا — لا جيوكودينغ ولا
  // خدمة مدفوعة، فقط Browser Geolocation. يُستعمل بعدها لحساب المسافة للمرضى وفتح الملاحة.
  function useMyLocation() {
    if (!navigator.geolocation) {
      showToast(t("متصفحك لا يدعم تحديد الموقع."), "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setValue("latitude", pos.coords.latitude, { shouldValidate: true });
        setValue("longitude", pos.coords.longitude, { shouldValidate: true });
        showToast(t("تم تحديد موقع العيادة — لا تنسَ حفظ التغييرات."), "success");
      },
      () => {
        setLocating(false);
        showToast(t("تعذّر الوصول إلى موقعك. تأكد من إذن الموقع في المتصفح."), "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  useEffect(() => {
    // ننتظر تحميل قائمتي التخصصات والولايات أيضًا: إن نُفِّذ reset() قبل رسم خيارات <select>،
    // لن يستطيع المتصفح تحديد القيمة الحالية لأن الخيار المطابق لن يكون موجودًا بعد.
    if (me?.doctor && specialties && wilayas) {
      reset({
        specialtyName: me.doctor.specialty?.nameAr ?? specialties.find(s => s.id === me.doctor.specialtyId)?.nameAr ?? "",
        wilayaId: me.doctor.wilayaId ?? "",
        cityId: me.doctor.cityId ?? "",
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
      const { consultationFee, ...rest } = values;
      await api.patch("/doctor/profile", {
        ...rest,
        yearsExperience: Number(values.yearsExperience),
        // داخل عيادة لها مدير لا نرسل السعر أبدًا (الخادم يرفض تغييره).
        ...(priceLocked ? {} : { consultationFee: Number(consultationFee) }),
      });
      showToast(t("تم تحديث ملفك المهني."), "success");
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
      <h1 className="text-2xl font-extrabold text-slate-900">{t("ملفي المهني")}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
        <SpecialtyInput {...register("specialtyName", { required: t("مطلوب") })} value={dirtyFields.specialtyName ? specialtyName : catalogName({ nameAr: specialtyName, nameFr: me?.doctor?.specialty?.nameFr })} />
        <div className="grid grid-cols-2 gap-3">
          <Select label={t("الولاية")} {...register("wilayaId", { required: t("مطلوب") })}>
            <option value="">{t("اختر")}</option>
            {wilayas?.map((w) => (
              <option key={w.id} value={w.id}>
                {catalogName(w)}
              </option>
            ))}
          </Select>
          <Select label={t("المدينة")} {...register("cityId", { required: t("مطلوب") })}>
            <option value="">{t("اختر")}</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameAr}
              </option>
            ))}
          </Select>
        </div>


        <Textarea label={t("نبذة تعريفية")} {...register("bio")} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("سنوات الخبرة")} type="number" {...register("yearsExperience")} />
          {priceLocked ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label={t("سعر الموعد في العيادة")}>
              <p className="label">{t("سعر الموعد")}</p>
              <p className="font-bold tabular-nums">{formatDzd(clinicTerms?.appointmentPriceDzd)}</p>
            </div>
          ) : (
            <Input label={t("سعر الاستشارة (دج)")} type="number" {...register("consultationFee")} />
          )}
        </div>
        {priceLocked && (
          <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-900" role="note">{t("سعر الموعد ونسبتك يحددهما مدير ")}{clinicTerms?.clinicName ? t("عيادة «{0}»", { "0": clinicTerms.clinicName }) : t("العيادة")}{t("، ولا يمكنك تعديلهما من هنا. نسبتك من قيمة الموعد: ")}<strong>{formatPercent(clinicTerms?.doctorSharePercent)}</strong>{t("، ونسبة العيادة: ")}<strong>{formatPercent(clinicTerms?.clinicSharePercent)}</strong>{t(". هذه النسبة خاصة بإيراد المواعيد ومنفصلة عن اشتراك MedBook. ")}</p>
        )}
        <Input label={t("رقم الهاتف")} {...register("phone")} />
        <Input label={t("العنوان")} {...register("address")} />

        <div>
          <p className="label flex items-center gap-1.5">
            <MapPin className="h-4 w-4" />{t(" موقع العيادة (لعرض المسافة للمرضى وفتح الملاحة) ")}</p>
          <input type="hidden" {...register("latitude")} />
          <input type="hidden" {...register("longitude")} />
          <button type="button" onClick={useMyLocation} disabled={locating} className="btn-outline mt-1 disabled:opacity-60">
            <LocateFixed className="h-4 w-4" /> {locating ? t("جارٍ تحديد الموقع...") : t("استخدم موقعي الحالي")}
          </button>
          <p className="mt-1 text-xs text-slate-400">
            {watchedLat != null && watchedLng != null
              ? t("تم ضبط موقع العيادة. اضغط الزر مجددًا لتحديثه إن انتقلت لعيادة أخرى.")
              : t("لم يُضبط موقع العيادة بعد — بدونه لن تظهر المسافة أو زر الملاحة للمرضى.")}
          </p>
        </div>

        <Button type="submit" loading={saving}>{t("حفظ التغييرات ")}</Button>
      </form>
    </div>
  );
}

