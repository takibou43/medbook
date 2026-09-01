import { Link } from "react-router-dom";
import { MapPin, Briefcase, Languages } from "lucide-react";
import { Doctor } from "../types";
import { Card } from "./ui/Card";
import { RatingStars } from "./ui/RatingStars";

export function DoctorCard({ doctor }: { doctor: Doctor }) {
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
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-4">
        <Link to={`/doctors/${doctor.id}`} className="btn-outline flex-1">
          عرض الملف
        </Link>
        <Link to={`/doctors/${doctor.id}#booking`} className="btn-primary flex-1">
          حجز موعد
        </Link>
      </div>
    </Card>
  );
}
