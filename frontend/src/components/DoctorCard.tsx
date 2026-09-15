import { Link } from "react-router-dom";
import { MapPin, Briefcase, Languages, Navigation, Clock } from "lucide-react";
import { Doctor } from "../types";
import { Card } from "./ui/Card";
import { RatingStars } from "./ui/RatingStars";
import { useNextSlotPreview } from "../hooks/useDoctors";
import { formatSlotLabel } from "../lib/slotLabel";

// showNextSlot: يجلب "أقرب موعد" فعليًا من الخادم (نفس مسار الحجز) — نتيح تفعيله فقط
// لعدد محدود من البطاقات في الصفحة (كما تفعل صفحة الحجز نفسها) تفاديًا لإثقال الخادم
// المجاني بعشرات الطلبات المتوازية عند عرض قائمة كبيرة من الأطباء.
export function DoctorCard({ doctor, showNextSlot = false }: { doctor: Doctor; showNextSlot?: boolean }) {
  const { data: nextSlot } = useNextSlotPreview(doctor.id, showNextSlot);

  return (
    <Card className="flex flex-col gap-4 transition hover:shadow-lg">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-100 text-2xl font-bold text-primary-700">
          {doctor.firstName[0]}
          {doctor.lastName[0]}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold text-slate-900">
            د. {doctor.firstName} {doctor.lastName}
          </h3>
          <p className="text-sm text-primary-700">{doctor.specialty?.nameAr}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <RatingStars value={doctor.avgRating} />
            <span className="text-xs text-slate-500">({doctor.reviewsCount})</span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 text-sm text-slate-600">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">
            {doctor.city?.nameAr}، {doctor.wilaya?.nameAr}
          </span>
          {doctor.distanceKm != null && (
            <span className="mr-auto flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              <Navigation className="h-3 w-3" /> {doctor.distanceKm} كم
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Briefcase className="h-4 w-4 shrink-0 text-slate-400" />
          <span>{doctor.yearsExperience} سنوات خبرة</span>
        </div>
        {doctor.languages?.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Languages className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{doctor.languages.join("، ")}</span>
          </div>
        )}
        {showNextSlot && nextSlot && (
          <div className="flex items-center gap-1.5 text-primary-700">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="font-semibold">أقرب موعد: {formatSlotLabel(nextSlot.date, nextSlot.startTime)}</span>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-4">
        <Link
          to={`/doctors/${doctor.id}`}
          state={doctor.distanceKm != null ? { distanceKm: doctor.distanceKm } : undefined}
          className="btn-outline flex-1"
        >
          عرض الملف
        </Link>
        <Link to={`/doctors/${doctor.id}#booking`} className="btn-primary flex-1">
          حجز موعد
        </Link>
      </div>
    </Card>
  );
}
