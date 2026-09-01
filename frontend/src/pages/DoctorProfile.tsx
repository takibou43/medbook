import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MapPin, Briefcase, Languages, Phone, Building2, Clock, CalendarDays } from "lucide-react";
import { useDoctor, useDoctorAvailability } from "../hooks/useDoctors";
import { useCreateAppointment } from "../hooks/useAppointments";
import { Spinner, ErrorState, EmptyState } from "../components/ui/States";
import { RatingStars } from "../components/ui/RatingStars";
import { VerificationBadge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Textarea } from "../components/ui/Input";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ui/Toast";
import { apiErrorMessage } from "../lib/api";

const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function nextNDays(n: number): Date[] {
  const days: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function DoctorProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { data: doctor, isLoading, isError } = useDoctor(id);
  const createAppointment = useCreateAppointment();

  const days = useMemo(() => nextNDays(14), []);
  const [selectedDate, setSelectedDate] = useState<Date>(days[0]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const { data: availability, isLoading: loadingSlots } = useDoctorAvailability(id, toDateStr(selectedDate));

  if (isLoading) return <Spinner />;
  if (isError || !doctor) return <ErrorState message="تعذّر تحميل ملف الطبيب." />;

  async function handleBook() {
    if (!user) {
      showToast("الرجاء تسجيل الدخول كمريض أولًا لإتمام الحجز.", "info");
      navigate("/login");
      return;
    }
    if (user.role !== "PATIENT") {
      showToast("الحجز متاح لحسابات المرضى فقط.", "error");
      return;
    }
    if (!selectedSlot) {
      showToast("الرجاء اختيار وقت الموعد.", "error");
      return;
    }
    if (!doctor) {
        return;
    }
    try {
      await createAppointment.mutateAsync({
        doctorId: doctor.id,
        date: toDateStr(selectedDate),
        startTime: selectedSlot,
        notes: notes || undefined,
      });
      showToast("تم إرسال طلب الحجز بنجاح! بانتظار تأكيد الطبيب.", "success");
      setSelectedSlot(null);
      setNotes("");
      navigate("/patient/appointments");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إتمام الحجز."), "error");
    }
  }

  return (
    <div className="container-app py-10">
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-3xl font-bold text-primary-700">
                {doctor.firstName[0]}
                {doctor.lastName[0]}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-extrabold text-slate-900">
                    د. {doctor.firstName} {doctor.lastName}
                  </h1>
                  <VerificationBadge status={doctor.verificationStatus} />
                </div>
                <p className="mt-1 font-semibold text-primary-700">{doctor.specialty?.nameAr}</p>
                <div className="mt-2 flex items-center gap-2">
                  <RatingStars value={doctor.avgRating} />
                  <span className="text-sm text-slate-500">
                    {doctor.avgRating.toFixed(1)} ({doctor.reviewsCount} تقييم)
                  </span>
                </div>
              </div>
            </div>

            {doctor.bio && <p className="mt-4 text-sm leading-relaxed text-slate-600">{doctor.bio}</p>}

            <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <MapPin className="h-4 w-4 text-slate-400" />
                {doctor.city?.nameAr}، {doctor.wilaya?.nameAr}
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Briefcase className="h-4 w-4 text-slate-400" />
                {doctor.yearsExperience} سنوات خبرة
              </div>
              {doctor.clinic && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  {doctor.clinic.nameAr} — {doctor.clinic.address}
                </div>
              )}
              {doctor.phone && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {doctor.phone}
                </div>
              )}
              {doctor.languages?.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Languages className="h-4 w-4 text-slate-400" />
                  {doctor.languages.join("، ")}
                </div>
              )}
              {doctor.consultationFee && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="font-semibold">{doctor.consultationFee} دج</span> — سعر الاستشارة
                </div>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 font-bold text-slate-900">التقييمات ({doctor.reviewsCount})</h2>
            {doctor.reviews && doctor.reviews.length > 0 ? (
              <div className="space-y-4">
                {doctor.reviews.map((r) => (
                  <div key={r.id} className="border-b border-slate-100 pb-4 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800">
                        {r.patient?.firstName} {r.patient?.lastName?.[0]}.
                      </span>
                      <RatingStars value={r.rating} size={14} />
                    </div>
                    {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">لا توجد تقييمات بعد.</p>
            )}
          </Card>
        </div>

        {/* Booking */}
        <div id="booking">
          <Card className="sticky top-20">
            <h2 className="mb-4 flex items-center gap-2 font-bold text-slate-900">
              <CalendarDays className="h-5 w-5 text-primary-600" />
              احجز موعدًا
            </h2>

            <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
              {days.map((d) => {
                const active = toDateStr(d) === toDateStr(selectedDate);
                return (
                  <button
                    key={toDateStr(d)}
                    onClick={() => {
                      setSelectedDate(d);
                      setSelectedSlot(null);
                    }}
                    className={`flex shrink-0 flex-col items-center rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      active ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <span>{DAY_NAMES[d.getDay()]}</span>
                    <span className="text-sm">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>

            <div className="mb-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Clock className="h-4 w-4" /> الأوقات المتاحة
              </p>
              {loadingSlots ? (
                <Spinner label="جارٍ تحميل الأوقات..." />
              ) : availability && availability.slots.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {availability.slots.map((slot) => (
                    <button
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
                <EmptyState title="لا توجد أوقات متاحة" description="جرّب اختيار يوم آخر." />
              )}
            </div>

            <Textarea
              label="معلومات إضافية (اختياري)"
              placeholder="صف سبب الزيارة باختصار..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            <Button className="mt-4 w-full" onClick={handleBook} loading={createAppointment.isPending} disabled={!selectedSlot}>
              تأكيد الحجز
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
