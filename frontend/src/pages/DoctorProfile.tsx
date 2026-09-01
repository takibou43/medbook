import { Link, useParams } from "react-router-dom";
import { MapPin, Briefcase, Languages, Phone, Building2, CalendarDays } from "lucide-react";
import { useDoctor } from "../hooks/useDoctors";
import { Spinner, ErrorState } from "../components/ui/States";
import { RatingStars } from "../components/ui/RatingStars";
import { VerificationBadge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";

export default function DoctorProfile() {
  const { id } = useParams();
  const { data: doctor, isLoading, isError } = useDoctor(id);

  if (isLoading) return <Spinner />;
  if (isError || !doctor) return <ErrorState message="تعذّر تحميل ملف الطبيب." />;

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

        {/* Booking CTA — الحجز الفعلي يتم عبر صفحة الحجز الموحّدة بدون تسجيل دخول */}
        <div id="booking">
          <Card className="sticky top-20 text-center">
            <CalendarDays className="mx-auto mb-3 h-8 w-8 text-primary-600" />
            <h2 className="mb-1 font-bold text-slate-900">احجز موعدًا</h2>
            <p className="mb-4 text-sm text-slate-500">لا حاجة لإنشاء حساب — فقط اختر الموعد المناسب لك.</p>
            <Link to={`/book?specialtyId=${doctor.specialtyId}&wilayaId=${doctor.wilaya.id}`} className="btn-primary w-full">
              احجز الآن
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
