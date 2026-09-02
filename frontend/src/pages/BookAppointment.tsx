import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarDays, Clock, CheckCircle2, Star, Stethoscope, MessageCircle, CalendarPlus, MapPin, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Spinner, EmptyState } from "../components/ui/States";
import { useToast } from "../components/ui/Toast";
import { Doctor } from "../types";

interface BookingForm {
  firstName: string;
  lastName: string;
  phone: string;
  wilayaId: string;
  specialtyId: string;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function maxDateStr() {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().slice(0, 10);
}

// 0551234567 -> 213551234567 (صيغة wa.me الدولية)
function toWhatsAppNumber(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (/^0[5-7]\d{8}$/.test(digits)) return "213" + digits.slice(1);
  if (/^213[5-7]\d{8}$/.test(digits)) return digits;
  return null;
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
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:تذكير بموعدك الطبي",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export default function BookAppointment() {
  const { showToast } = useToast();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();

  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [date, setDate] = useState(todayStr());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
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
    formState: { errors },
  } = useForm<BookingForm>({
    defaultValues: { wilayaId: "", specialtyId: "" },
  });

  const wilayaId = watch("wilayaId");
  const specialtyId = watch("specialtyId");

  useEffect(() => {
    setSelectedDoctor(null);
    setSelectedSlot(null);
  }, [wilayaId, specialtyId]);

  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDoctor, date]);

  const doctorsEnabled = Boolean(wilayaId && specialtyId);
  const { data: doctors, isFetching: loadingDoctors } = useQuery({
    queryKey: ["book-doctors", wilayaId, specialtyId],
    queryFn: async () =>
      (await api.get<{ data: { items: Doctor[] } }>("/doctors", { params: { wilayaId, specialtyId, pageSize: 50 } })).data.data.items,
    enabled: doctorsEnabled,
  });

  const slotsEnabled = Boolean(selectedDoctor && date);
  const { data: slots, isFetching: loadingSlots } = useQuery({
    queryKey: ["book-slots", selectedDoctor?.id, date],
    queryFn: async () =>
      (await api.get<{ data: { slots: string[] } }>(`/doctors/${selectedDoctor!.id}/availability`, { params: { date } })).data.data.slots,
    enabled: slotsEnabled,
  });

  const bookMutation = useMutation({
    mutationFn: async (values: BookingForm) =>
      (
        await api.post("/booking", {
          ...values,
          doctorId: selectedDoctor!.id,
          date,
          startTime: selectedSlot,
        })
      ).data.data,
  });

  async function onSubmit(values: BookingForm) {
    if (!selectedDoctor) {
      showToast("الرجاء اختيار طبيب.", "error");
      return;
    }
    if (!selectedSlot) {
      showToast("الرجاء اختيار وقت الموعد.", "error");
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
    const dateLabel = new Date(confirmed.date).toLocaleDateString("ar-DZ");
    const waNumber = toWhatsAppNumber(confirmed.doctorPhone);
    const waText = encodeURIComponent(
      `السلام عليكم، أنا ${confirmed.patientName}. حجزت موعدًا عبر MedBook مع د. ${confirmed.doctorName} يوم ${dateLabel} على الساعة ${confirmed.startTime}.` +
        (confirmed.patientPhone ? ` رقم هاتفي: ${confirmed.patientPhone}.` : "") +
        " أرجو تأكيد الموعد، شكرًا."
    );
    // بدون رقم للطبيب نفتح واتساب برسالة جاهزة ليختار المريض المُرسَل إليه (أو يحفظها لنفسه).
    const waHref = waNumber ? `https://wa.me/${waNumber}?text=${waText}` : `https://wa.me/?text=${waText}`;

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
          <h1 className="text-xl font-extrabold text-slate-900">تم إرسال طلب حجزك بنجاح!</h1>
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
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 font-semibold text-white transition hover:brightness-95"
            >
              <MessageCircle className="h-4 w-4" />
              {waNumber ? "أرسل تأكيدًا للطبيب عبر واتساب" : "شارك تفاصيل الحجز عبر واتساب"}
            </a>

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
              setSelectedSlot(null);
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
          <p className="mt-1 text-slate-500">لا حاجة لإنشاء حساب — فقط املأ البيانات وحدد الموعد المناسب.</p>
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

          <div className="grid grid-cols-2 gap-3">
            <Select label="الولاية" error={errors.wilayaId?.message} {...register("wilayaId", { required: "مطلوب" })}>
              <option value="">اختر الولاية</option>
              {wilayas?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nameAr}
                </option>
              ))}
            </Select>
            <Select label="التخصص" error={errors.specialtyId?.message} {...register("specialtyId", { required: "مطلوب" })}>
              <option value="">اختر التخصص</option>
              {specialties?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameAr}
                </option>
              ))}
            </Select>
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
                  {doctors.map((d) => (
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
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-sm text-amber-500">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        {d.avgRating > 0 ? d.avgRating.toFixed(1) : "جديد"}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState title="لا يوجد أطباء متاحون" description="جرّب ولاية أو تخصصًا مختلفًا." />
              )}
            </div>
          )}

          {selectedDoctor && (
            <>
              <Input
                label="تاريخ الموعد"
                type="date"
                min={todayStr()}
                max={maxDateStr()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />

              <div>
                <p className="label mb-2 flex items-center gap-1.5">
                  <Clock className="h-4 w-4" /> الأوقات المتاحة
                </p>
                {loadingSlots ? (
                  <Spinner label="جارٍ تحميل الأوقات..." />
                ) : slots && slots.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {slots.map((slot) => (
                      <button
                        type="button"
                        key={slot}
                        onClick={() => setSelectedSlot(slot)}
                        className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                          selectedSlot === slot
                            ? "border-primary-600 bg-primary-600 text-white"
                            : "border-slate-200 text-slate-700 hover:border-primary-300"
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="لا توجد أوقات متاحة" description="جرّب تاريخًا آخر." />
                )}
              </div>
            </>
          )}

          <Button type="submit" className="w-full" loading={bookMutation.isPending} disabled={!selectedDoctor || !selectedSlot}>
            <CalendarDays className="ml-1.5 h-4 w-4" /> تأكيد الحجز
          </Button>
        </form>
      </div>
    </div>
  );
}
