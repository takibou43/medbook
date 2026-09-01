import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarDays, Clock, CheckCircle2 } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Spinner, EmptyState } from "../components/ui/States";
import { useToast } from "../components/ui/Toast";

interface BookingForm {
  firstName: string;
  lastName: string;
  phone: string;
  wilayaId: string;
  specialtyId: string;
  date: string;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function maxDateStr() {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().slice(0, 10);
}

export default function BookAppointment() {
  const [params] = useSearchParams();
  const { showToast } = useToast();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ date: string; startTime: string; specialty?: string } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<BookingForm>({
    defaultValues: {
      wilayaId: params.get("wilayaId") ?? "",
      specialtyId: params.get("specialtyId") ?? "",
      date: todayStr(),
    },
  });

  const wilayaId = watch("wilayaId");
  const specialtyId = watch("specialtyId");
  const date = watch("date");

  useEffect(() => {
    setSelectedSlot(null);
  }, [wilayaId, specialtyId, date]);

  const slotsEnabled = Boolean(wilayaId && specialtyId && date);
  const { data: slots, isFetching: loadingSlots } = useQuery({
    queryKey: ["booking-slots", wilayaId, specialtyId, date],
    queryFn: async () => (await api.get<{ data: { slots: string[] } }>("/booking/slots", { params: { wilayaId, specialtyId, date } })).data.data.slots,
    enabled: slotsEnabled,
  });

  const bookMutation = useMutation({
    mutationFn: async (values: BookingForm) =>
      (
        await api.post("/booking", {
          ...values,
          startTime: selectedSlot,
        })
      ).data.data,
  });

  const specialtyLabel = useMemo(
    () => specialties?.find((s) => s.id === specialtyId)?.nameAr,
    [specialties, specialtyId]
  );

  async function onSubmit(values: BookingForm) {
    if (!selectedSlot) {
      showToast("الرجاء اختيار وقت الموعد.", "error");
      return;
    }
    try {
      const appointment = await bookMutation.mutateAsync(values);
      setConfirmed({ date: appointment.date, startTime: appointment.startTime, specialty: specialtyLabel });
      showToast("تم إرسال طلب الحجز بنجاح!", "success");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إتمام الحجز."), "error");
    }
  }

  if (confirmed) {
    return (
      <div className="container-app flex min-h-[70vh] items-center justify-center py-10">
        <Card className="max-w-md text-center">
          <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-emerald-500" />
          <h1 className="text-xl font-extrabold text-slate-900">تم إرسال طلب حجزك بنجاح!</h1>
          <p className="mt-2 text-slate-600">
            {confirmed.specialty && `${confirmed.specialty} — `}
            {new Date(confirmed.date).toLocaleDateString("ar-DZ")} الساعة {confirmed.startTime}
          </p>
          <p className="mt-1 text-sm text-slate-500">سيتصل بك الطبيب أو العيادة لتأكيد الموعد.</p>
          <Button className="mt-6" onClick={() => setConfirmed(null)}>
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
            <Input label="الاسم" error={errors.firstName?.message} {...register("firstName", { required: "مطلوب", minLength: { value: 2, message: "قصير جدًا" } })} />
            <Input label="اللقب" error={errors.lastName?.message} {...register("lastName", { required: "مطلوب", minLength: { value: 2, message: "قصير جدًا" } })} />
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

          <Input
            label="تاريخ الموعد"
            type="date"
            min={todayStr()}
            max={maxDateStr()}
            error={errors.date?.message}
            {...register("date", { required: "مطلوب" })}
          />

          <div>
            <p className="label mb-2 flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> الأوقات المتاحة
            </p>
            {!slotsEnabled ? (
              <p className="text-sm text-slate-400">اختر الولاية والتخصص والتاريخ أولًا.</p>
            ) : loadingSlots ? (
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
              <EmptyState title="لا توجد أوقات متاحة" description="جرّب تاريخًا آخر أو تخصصًا/ولاية مختلفة." />
            )}
          </div>

          <Button type="submit" className="w-full" loading={bookMutation.isPending} disabled={!selectedSlot}>
            <CalendarDays className="ml-1.5 h-4 w-4" /> تأكيد الحجز
          </Button>
        </form>
      </div>
    </div>
  );
}
