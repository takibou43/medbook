import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueries, useMutation } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  CheckCircle2,
  Star,
  Stethoscope,
  CalendarPlus,
  MapPin,
  Search,
  Baby,
  HeartPulse,
  Eye,
  Smile,
  Sparkles,
  Flower2,
  Scissors,
  Brain,
  Ear,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Spinner, EmptyState } from "../components/ui/States";
import { useToast } from "../components/ui/Toast";
import { Doctor } from "../types";

// مطابقة مفتاح الأيقونة المخزّن لكل تخصص (Specialty.icon) برمز بصري —
// لا يوجد أيقونة "سن" جاهزة في مكتبة lucide-react فاستُعيض عنها بـ Smile.
const SPECIALTY_ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  baby: Baby,
  "heart-pulse": HeartPulse,
  eye: Eye,
  tooth: Smile,
  sparkles: Sparkles,
  flower: Flower2,
  scissors: Scissors,
  brain: Brain,
  ear: Ear,
};

function specialtyIcon(icon?: string | null): LucideIcon {
  return (icon && SPECIALTY_ICONS[icon]) || Stethoscope;
}

interface BookingForm {
  firstName: string;
  lastName: string;
  phone: string;
  wilayaId: string;
  specialtyId: string;
}

interface NextSlot {
  date: string;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

// ملف تقويم قياسي (.ics) يعمل مع تقويم الهاتف وGoogle Calendar — تذكير مجاني بالكامل.
function buildIcs(c: { date: string; startTime: string; doctorName: string; place: string }) {
  const [h, m] = c.startTime.split(":").map(Number);
  const start = new Date(c.date);
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MedBook//AR//",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@medbook.dz`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:موعد طبي مع د. ${c.doctorName}`,
    `LOCATION:${c.place}`,
    "DESCRIPTION:حجز عبر MedBook",
    // تذكير تلقائي على هاتف المريض قبل الموعد بـ 10 دقائق (وتذكير مبكر قبل ساعتين).
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:موعدك الطبي بعد 10 دقائق",
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:تذكير بموعدك الطبي اليوم",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// تسمية مختصرة وودّية لأقرب دور معروض في قائمة الأطباء ("اليوم"، "غدًا"، أو التاريخ).
function formatSlotLabel(dateStr: string, startTime: string): string {
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diffDays === 0) return `اليوم ${startTime}`;
  if (diffDays === 1) return `غدًا ${startTime}`;
  return `${target.toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long" })} — ${startTime}`;
}
export default function BookAppointment() {
  const { showToast } = useToast();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();

  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [confirmed, setConfirmed] = useState<{
    date: string;
    startTime: string;
    doctorName: string;
    doctorPhone?: string | null;
    place: string;
    patientName: string;
    patientPhone?: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BookingForm>({
    defaultValues: { wilayaId: "", specialtyId: "" },
  });

  const wilayaId = watch("wilayaId");
  const specialtyId = watch("specialtyId");

  useEffect(() => {
    setSelectedDoctor(null);
  }, [wilayaId, specialtyId]);

  const doctorsEnabled = Boolean(wilayaId && specialtyId);
  const { data: doctors, isFetching: loadingDoctors } = useQuery({
    queryKey: ["book-doctors", wilayaId, specialtyId],
    queryFn: async () =>
      (await api.get<{ data: { items: Doctor[] } }>("/doctors", { params: { wilayaId, specialtyId, pageSize: 50 } })).data.data.items,
    enabled: doctorsEnabled,
  });

  // معاينة أقرب دور لكل طبيب مباشرة في القائمة (قبل اختياره)، حتى يقارن المريض
  // بين الأطباء المتاحين ويختار الأسرع دون أن يفتح كل طبيب على حدة. نكتفي بأول
  // 20 طبيبًا في القائمة تفاديًا لإثقال الخادم المجاني بعدد كبير من الطلبات المتوازية.
  const previewDoctors = (doctors ?? []).slice(0, 20);
  const nextSlotPreviews = useQueries({
    queries: previewDoctors.map((d) => ({
      queryKey: ["next-slot-preview", d.id],
      queryFn: async () => (await api.get<{ data: NextSlot }>("/booking/next-slot", { params: { doctorId: d.id } })).data.data,
      enabled: doctorsEnabled,
      retry: false,
      staleTime: 20000,
    })),
  });

  // الدور الذي سيمنحه النظام تلقائيًا — المريض لا يختار الوقت، فقط يرى ما سيُحجز له.
  const { data: nextSlot, isFetching: loadingSlot } = useQuery({
    queryKey: ["next-slot", selectedDoctor?.id],
    queryFn: async () =>
      (await api.get<{ data: NextSlot }>("/booking/next-slot", { params: { doctorId: selectedDoctor!.id } })).data.data,
    enabled: Boolean(selectedDoctor),
    retry: false,
    // نُحدّث الدور المعروض كل نصف دقيقة تحسبًا لحجز مريض آخر قبله.
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const bookMutation = useMutation({
    // لا نرسل التاريخ ولا الوقت — الخادم هو من يعيّن الدور التالي لحظة الحجز.
    mutationFn: async (values: BookingForm) =>
      (await api.post("/booking", { ...values, doctorId: selectedDoctor!.id })).data.data,
  });

  async function onSubmit(values: BookingForm) {
    if (!selectedDoctor) {
      showToast("الرجاء اختيار طبيب.", "error");
      return;
    }
    try {
      const appointment = await bookMutation.mutateAsync(values);
      setConfirmed({
        date: appointment.date,
        startTime: appointment.startTime,
        doctorName: `${selectedDoctor.firstName} ${selectedDoctor.lastName}`,
        doctorPhone: selectedDoctor.phone ?? selectedDoctor.clinic?.phone ?? null,
        place: [selectedDoctor.clinic?.nameAr, selectedDoctor.address ?? selectedDoctor.clinic?.address, selectedDoctor.city?.nameAr]
          .filter(Boolean)
          .join("، "),
        patientName: `${values.firstName} ${values.lastName}`,
        patientPhone: values.phone,
      });
      showToast("تم إرسال طلب الحجز بنجاح!", "success");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إتمام الحجز."), "error");
    }
  }

  if (confirmed) {
    const dateLabel = new Date(confirmed.date).toLocaleDateString("ar-DZ", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    function downloadIcs() {
      const blob = new Blob([buildIcs(confirmed!)], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "medbook-appointment.ics";
      a.click();
      URL.revokeObjectURL(url);
    }

    return (
      <div className="container-app flex min-h-[70vh] items-center justify-center py-10">
        <Card className="w-full max-w-md text-center">
          <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-emerald-500" />
          <h1 className="text-xl font-extrabold text-slate-900">تم تأكيد حجزك!</h1>
          <p className="mt-1 text-sm text-slate-500">دورك محجوز باسمك لدى الطبيب</p>
          <p className="mt-2 font-semibold text-slate-700">د. {confirmed.doctorName}</p>
          <p className="text-slate-600">
            {dateLabel} — الساعة {confirmed.startTime}
          </p>
          {confirmed.place && (
            <p className="mt-1 flex items-center justify-center gap-1 text-sm text-slate-500">
              <MapPin className="h-4 w-4" /> {confirmed.place}
            </p>
          )}

          <div className="mt-6 space-y-2">
            <button
              type="button"
              onClick={downloadIcs}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 font-semibold text-slate-700 transition hover:border-primary-300"
            >
              <CalendarPlus className="h-4 w-4" /> أضف الموعد إلى تقويمك (تذكير تلقائي)
            </button>

            {confirmed.patientPhone && (
              <Link
                to="/track"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 font-semibold text-slate-700 transition hover:border-primary-300"
              >
                <Search className="h-4 w-4" /> تتبّع حجزي أو إلغاؤه لاحقًا
              </Link>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-400">
            احتفظ برقم هاتفك المُدخل — تستطيع به عرض حجزك أو إلغاؤه في أي وقت من صفحة «تتبّع حجزي».
          </p>

          <Button
            variant="ghost"
            className="mt-4"
            onClick={() => {
              setConfirmed(null);
              setSelectedDoctor(null);
            }}
          >
            حجز موعد آخر
          </Button>
        </Card>
      </div>
    );
  }
  return (
    <div className="container-app py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold text-slate-900">احجز موعدك الآن</h1>
          <p className="mt-1 text-slate-500">
            لا حاجة لإنشاء حساب — املأ بياناتك واختر الطبيب، والموقع يمنحك أول دور متاح تلقائيًا.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="الاسم"
              error={errors.firstName?.message}
              {...register("firstName", { required: "مطلوب", minLength: { value: 2, message: "قصير جدًا" } })}
            />
            <Input
              label="اللقب"
              error={errors.lastName?.message}
              {...register("lastName", { required: "مطلوب", minLength: { value: 2, message: "قصير جدًا" } })}
            />
          </div>

          <Input
            label="رقم الهاتف (اختياري)"
            placeholder="0551234567"
            error={errors.phone?.message}
            {...register("phone", { pattern: { value: /^0[5-7][0-9]{8}$/, message: "رقم هاتف جزائري غير صالح" } })}
          />

          <Select label="الولاية" error={errors.wilayaId?.message} {...register("wilayaId", { required: "مطلوب" })}>
            <option value="">اختر الولاية</option>
            {wilayas?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nameAr}
              </option>
            ))}
          </Select>

          <div>
            <p className="label mb-2">التخصص</p>
            {/* حقل مخفي يحمل قيمة التخصص الفعلية للتحقق عبر react-hook-form؛ الاختيار يتم بصريًا بالأسفل. */}
            <input type="hidden" {...register("specialtyId", { required: "الرجاء اختيار التخصص" })} />
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {specialties?.map((s) => {
                const Icon = specialtyIcon(s.icon);
                const active = specialtyId === s.id;
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setValue("specialtyId", s.id, { shouldValidate: true })}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition ${
                      active ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600 hover:border-primary-300"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs font-semibold leading-tight">{s.nameAr}</span>
                  </button>
                );
              })}
            </div>
            {errors.specialtyId && <p className="mt-1.5 text-xs text-red-500">{errors.specialtyId.message}</p>}
          </div>

          {doctorsEnabled && (
            <div>
              <p className="label mb-2 flex items-center gap-1.5">
                <Stethoscope className="h-4 w-4" /> اختر الطبيب
              </p>
              {loadingDoctors ? (
                <Spinner label="جارٍ البحث عن أطباء..." />
              ) : doctors && doctors.length > 0 ? (
                <div className="space-y-2">
                  {doctors.map((d, i) => {
                    const preview = nextSlotPreviews[i];
                    return (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => setSelectedDoctor(d)}
                        className={`flex w-full items-center justify-between rounded-xl border p-3 text-right transition ${
                          selectedDoctor?.id === d.id ? "border-primary-600 bg-primary-50" : "border-slate-200 hover:border-primary-300"
                        }`}
                      >
                        <div>
                          <p className="font-semibold text-slate-800">
                            د. {d.firstName} {d.lastName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {d.city?.nameAr}
                            {d.clinic ? ` — ${d.clinic.nameAr}` : ""} · خبرة {d.yearsExperience} سنوات
                          </p>
                          {preview?.data && (
                            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              أقرب دور: {formatSlotLabel(preview.data.date, preview.data.startTime)}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-sm text-amber-500">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                          {d.avgRating > 0 ? d.avgRating.toFixed(1) : "جديد"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="لا يوجد أطباء متاحون" description="جرّب ولاية أو تخصصًا مختلفًا." />
              )}
            </div>
          )}

          {selectedDoctor && (
            <div>
              <p className="label mb-2 flex items-center gap-1.5">
                <Clock className="h-4 w-4" /> دورك الذي سيحدده الموقع
              </p>
              {loadingSlot && !nextSlot ? (
                <Spinner label="جارٍ تحديد أول دور متاح..." />
              ) : nextSlot ? (
                <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-center">
                  <p className="text-sm text-slate-600">أول دور متاح لدى هذا الطبيب</p>
                  <p className="mt-1 text-lg font-extrabold text-primary-800">
                    {new Date(nextSlot.date).toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long" })}
                  </p>
                  <p className="text-2xl font-extrabold text-primary-700">{nextSlot.startTime}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    مدة الجلسة {nextSlot.slotMinutes} دقيقة — الأدوار تُمنح بالترتيب حسب أسبقية الحجز.
                  </p>
                </div>
              ) : (
                <EmptyState
                  title="لا توجد أدوار متاحة"
                  description="لم يحدد هذا الطبيب أوقات عمله بعد، أو أدواره مكتملة. جرّب طبيبًا آخر."
                />
              )}
            </div>
          )}

          <Button type="submit" className="w-full" loading={bookMutation.isPending} disabled={!selectedDoctor || !nextSlot}>
            <CalendarDays className="ml-1.5 h-4 w-4" /> تأكيد الحجز وأخذ الدور
          </Button>
        </form>
      </div>
    </div>
  );
}
