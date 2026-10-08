import { forwardRef, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { LocateFixed, MapPin, Star, Stethoscope } from "lucide-react";
import { api } from "../../lib/api";
import { Doctor, NextSlot, Specialty } from "../../types";
import { distanceToDoctor } from "../../lib/geo";
import { doctorAddress } from "../../lib/booking";
import { RegionFilters } from "./RegionFilters";
import { directionsUrl } from "../../lib/patientPresentation";
import { formatSlotLabel } from "../../lib/slotLabel";
import { useToast } from "../ui/Toast";
import { StepHeading, BackButton, InlineError } from "./StepParts";
import { DoctorListSkeleton } from "./Skeletons";

interface Props {
  specialty: Specialty | null;
  // أطباء هذا التخصص (مفلترون مسبقًا من قائمة الأطباء الموثّقين المحمَّلة مرة واحدة).
  doctors: Doctor[];
  loading: boolean;
  error: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onSelect: (doctor: Doctor) => void;
  onBack: () => void;
  /** يُبلَّغ به عدّاد الحجوزات عند اختيار المريض ولاية ("" = كل الولايات). */
  onWilayaChange?: (wilayaId: string) => void;
}

// معاينة "أقرب دور" لأول عدد محدود من الأطباء فقط — لا نُغرق الخادم المجاني بطلبات متوازية
// (لا يوجد endpoint مجمّع للمعاينة، وهذا هو النمط الذي كانت تعتمده الصفحة أصلًا).
const PREVIEW_LIMIT = 10;

function DoctorAvatar({ doctor }: { doctor: Doctor }) {
  if (doctor.photoUrl) {
    return <img src={doctor.photoUrl} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-full border border-slate-200 object-cover" />;
  }
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600" aria-hidden="true">
      <Stethoscope className="h-7 w-7" />
    </span>
  );
}

export const DoctorStep = forwardRef<HTMLHeadingElement, Props>(({ specialty, doctors, loading, error, errorMessage, onRetry, onSelect, onBack, onWilayaChange }, ref) => {
  const { showToast } = useToast();
  const [wilayaFilter, setWilayaFilter] = useState<string>("");
  const [cityFilter, setCityFilter] = useState("");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const visible = useMemo(() => {
    const list = doctors.filter(d => (!wilayaFilter || d.wilaya.id === wilayaFilter) && (!cityFilter || d.city?.id === cityFilter));
    if (!pos) return list.map((d) => ({ doctor: d, distance: null as ReturnType<typeof distanceToDoctor> }));
    return list
      .map((d) => ({ doctor: d, distance: distanceToDoctor(d, pos) }))
      .sort((a, b) => (a.distance?.km ?? Infinity) - (b.distance?.km ?? Infinity));
  }, [doctors, wilayaFilter, cityFilter, pos]);

  const previews = useQueries({
    queries: visible.slice(0, PREVIEW_LIMIT).map(({ doctor }) => ({
      queryKey: ["next-slot-preview", doctor.id],
      queryFn: async () => (await api.get<{ data: NextSlot }>("/booking/next-slot", { params: { doctorId: doctor.id } })).data.data,
      retry: false,
      staleTime: 20000,
    })),
  });

  // خيار اختياري تمامًا: لا يُطلب إذن الموقع إلا عند الضغط، والحجز لا يتطلب GPS إطلاقًا.
  function sortByNearest() {
    if (!navigator.geolocation) {
      showToast("متصفحك لا يدعم تحديد الموقع. اختر الولاية والبلدية يدويًا.", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        setLocating(false);
        showToast("تعذّر الوصول إلى موقعك. اختر الولاية والبلدية يدويًا.", "error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  return (
    <section aria-labelledby="step-doctor-title">
      <BackButton onClick={onBack}>تغيير التخصص</BackButton>
      <StepHeading ref={ref} id="step-doctor-title" hint="اختر الطبيب الذي تريد الحجز عنده.">
        {specialty ? `أطباء ${specialty.nameAr}` : "اختر الطبيب"}
      </StepHeading>

      {loading ? (
        <DoctorListSkeleton />
      ) : error ? (
        <InlineError title="تعذّر تحميل الأطباء." message={errorMessage ?? "أعد المحاولة بعد قليل."} onRetry={onRetry} />
      ) : doctors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 glass p-8 text-center">
          <Stethoscope className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
          <p className="mt-2 font-bold text-slate-800">لا يوجد أطباء متاحون حاليًا لهذا التخصص.</p>
          <p className="mt-1 text-sm text-slate-500">جرّب تخصصًا آخر.</p>
          <button
            type="button"
            onClick={onBack}
            className="btn-primary mt-4 min-h-[44px] px-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            العودة إلى التخصصات
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={sortByNearest}
              disabled={locating}
              aria-pressed={Boolean(pos)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60 ${
                pos ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-300 bg-white text-slate-700 hover:border-primary-400"
              }`}
            >
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
              {locating ? "جارٍ تحديد موقعك..." : pos ? "مرتّبون حسب الأقرب إليك" : "الأطباء القريبون منك"}
            </button>
          </div>

          <RegionFilters wilayaId={wilayaFilter} cityId={cityFilter} onChange={(w, c) => { setWilayaFilter(w); setCityFilter(c); onWilayaChange?.(w); }} />
          <button type="button" className="btn-outline mb-3" onClick={() => { setWilayaFilter(""); setCityFilter(""); setPos(null); onWilayaChange?.(""); }}>مسح الفلاتر</button>
          {visible.length === 0 && <p className="glass p-4" role="status">لا يوجد أطباء يطابقون المنطقة المختارة. جرّب منطقة أخرى أو امسح الفلاتر.</p>}
          <ul className="space-y-3">
            {visible.map(({ doctor: d, distance }, i) => {
              const preview = i < PREVIEW_LIMIT ? previews[i] : undefined;
              const address = doctorAddress(d);
              const directions = directionsUrl(address, d.city?.nameAr, d.wilaya.nameAr, d.latitude, d.longitude);
              const place = [d.clinic?.nameAr, d.city?.nameAr, d.wilaya.nameAr].filter(Boolean).join(" — ");
              return (
                <li key={d.id} className="glass p-4">
                  <div className="flex gap-3">
                    <DoctorAvatar doctor={d} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold leading-snug text-slate-900">
                          د. {d.firstName} {d.lastName}
                        </p>
                        <span className="flex shrink-0 items-center gap-1 text-sm text-amber-600">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                          {d.avgRating > 0 ? d.avgRating.toFixed(1) : "جديد"}
                          {typeof d.reviewsCount === "number" && <span className="text-xs text-slate-500">({d.reviewsCount} مراجعة)</span>}
                        </span>
                      </div>
                      <p className="text-sm text-primary-700">{d.specialty.nameAr}</p>
                      {place && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{place}</span>
                        </p>
                      )}
                      {address && <p className="mt-0.5 ps-[18px] text-xs text-slate-400">{address}</p>}
                      {distance?.exact && (
                        <p className="mt-0.5 ps-[18px] text-xs font-semibold text-slate-600">
                          على بعد {distance.km < 1 ? "أقل من 1" : Math.round(distance.km * 10) / 10} كم
                        </p>
                      )}
                    </div>
                  </div>

                  {(d.bio || d.languages?.length || d.yearsExperience > 0 || d.consultationFee != null) && <details className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
                    <summary className="min-h-[48px] cursor-pointer font-semibold text-primary-700">معلومات الطبيب</summary>
                    {d.bio && <p className="mt-2 whitespace-pre-line break-words text-slate-600">{d.bio}</p>}
                    {d.yearsExperience > 0 && <p className="mt-2">الخبرة: {d.yearsExperience} سنوات</p>}
                    {d.languages?.length > 0 && <p className="mt-2">اللغات: {d.languages.join("، ")}</p>}
                    {d.consultationFee != null && Number.isFinite(d.consultationFee) && <p className="mt-2">سعر الاستشارة المسجّل: {d.consultationFee.toLocaleString("ar-DZ")} دج</p>}
                  </details>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(d.clinic?.phone || d.phone) && <a className="btn-outline" href={`tel:${d.clinic?.phone || d.phone}`}>اتصل بالعيادة</a>}
                    {directions && <a className="btn-outline" href={directions} target="_blank" rel="noopener noreferrer">الاتجاهات</a>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <p className="min-w-0 text-xs font-semibold" aria-live="polite">
                      {preview?.isLoading ? (
                        <span className="text-slate-400">جارٍ التحقق من التوفر...</span>
                      ) : preview?.data ? (
                        <span className="flex items-center gap-1.5 text-emerald-700">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                          أقرب دور: {formatSlotLabel(preview.data.date, preview.data.startTime)}
                        </span>
                      ) : preview?.isError ? (
                        <span className="text-slate-500">لا تتوفر أدوار حاليًا</span>
                      ) : null}
                    </p>
                    <button
                      type="button"
                      onClick={() => onSelect(d)}
                      aria-label={`اختيار الطبيب ${d.firstName} ${d.lastName}`}
                      className="btn-primary min-h-[44px] shrink-0 px-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                    >
                      اختيار الطبيب
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
});
DoctorStep.displayName = "DoctorStep";
