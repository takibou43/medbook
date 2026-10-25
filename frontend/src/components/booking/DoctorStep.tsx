import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLocale, catalogName, getLanguage } from "../../i18n/locale.ts";
import { forwardRef, useMemo, useState } from "react";
import { LocateFixed, MapPin, Star, Stethoscope } from "lucide-react";
import { Doctor, Specialty } from "../../types";
import { distanceToDoctor } from "../../lib/geo";
import { doctorAddress } from "../../lib/booking";
import { RegionFilters } from "./RegionFilters";
import { directionsUrl } from "../../lib/patientPresentation";
import { NextSlotPreview } from "./NextSlotPreview";
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

function DoctorAvatar({ doctor }: { doctor: Doctor }) {
  useLanguage();
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
  useLanguage();
  const { showToast } = useToast();
  const [wilayaFilter, setWilayaFilter] = useState<string>("");
  const [regionOpen, setRegionOpen] = useState(false);
  const [cityFilter, setCityFilter] = useState("");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const visible = useMemo(() => {
    const list = doctors.filter(d => (!wilayaFilter || d.wilaya.id === wilayaFilter) && (!cityFilter || d.city?.id === cityFilter));
    if (!pos) return list.map((d) => ({ doctor: d, distance: null as ReturnType<typeof distanceToDoctor> }));
    return list
      .map((d) => ({ doctor: d, distance: distanceToDoctor(d, pos) }))
      .sort((a, b) => (a.distance?.km ?? Infinity) - (b.distance?.km ?? Infinity));
  }, [doctors, wilayaFilter, cityFilter, pos, getLanguage()]);

  // خيار اختياري تمامًا: لا يُطلب إذن الموقع إلا عند الضغط، والحجز لا يتطلب GPS إطلاقًا.
  function sortByNearest() {
    if (!navigator.geolocation) {
      showToast(t("متصفحك لا يدعم تحديد الموقع. اختر الولاية والبلدية يدويًا."), "error");
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
        showToast(t("تعذّر الوصول إلى موقعك. اختر الولاية والبلدية يدويًا."), "error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  return (
    <section aria-labelledby="step-doctor-title">
      <BackButton onClick={onBack}>{t("تغيير التخصص")}</BackButton>
      <StepHeading ref={ref} id="step-doctor-title" hint={t("اختر الطبيب الذي تريد الحجز عنده.")}>
        {specialty ? t("أطباء {0}", { "0": catalogName(specialty) }) : t("اختر الطبيب")}
      </StepHeading>

      {loading ? (
        <DoctorListSkeleton />
      ) : error ? (
        <InlineError title={t("تعذّر تحميل الأطباء.")} message={errorMessage ?? t("أعد المحاولة بعد قليل.")} onRetry={onRetry} />
      ) : doctors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 glass p-8 text-center">
          <Stethoscope className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
          <p className="mt-2 font-bold text-slate-800">{t("لا يوجد أطباء متاحون حاليًا لهذا التخصص.")}</p>
          <p className="mt-1 text-sm text-slate-500">{t("جرّب تخصصًا آخر.")}</p>
          <button
            type="button"
            onClick={onBack}
            className="btn-primary mt-4 min-h-[44px] px-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >{t("العودة إلى التخصصات ")}</button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={sortByNearest}
              disabled={locating}
              aria-pressed={Boolean(pos)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60 ${
                pos ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-300 bg-white text-slate-700 hover:border-primary-400"
              }`}
            >
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
              {locating ? t("جارٍ تحديد موقعك...") : pos ? t("مرتّبون حسب الأقرب إليك") : t("القريبون مني")}
            </button>
            <button type="button" className="btn-outline min-h-[44px] text-xs" aria-expanded={regionOpen} aria-controls="doctor-region-filters" onClick={() => setRegionOpen(open => !open)}>{t("تحديد المنطقة — اختياري")}{(wilayaFilter || cityFilter) && <span className="ms-1 h-2 w-2 rounded-full bg-primary-600" />}</button>
          </div>

          <div id="doctor-region-filters" hidden={!regionOpen}><RegionFilters wilayaId={wilayaFilter} cityId={cityFilter} onChange={(w, c) => { setWilayaFilter(w); setCityFilter(c); onWilayaChange?.(w); }} /></div>
          {(wilayaFilter || cityFilter || pos) && <button type="button" className="btn-outline mb-3" onClick={() => { setWilayaFilter(""); setCityFilter(""); setPos(null); onWilayaChange?.(""); }}>{t("مسح الفلاتر")}</button>}
          {visible.length === 0 && <p className="glass p-4" role="status">{t("لا يوجد أطباء يطابقون المنطقة المختارة. جرّب منطقة أخرى أو امسح الفلاتر.")}</p>}
          <ul className="space-y-3">
            {visible.map(({ doctor: d, distance }) => {
              const address = doctorAddress(d);
              const directions = directionsUrl(address, d.city?.nameAr, catalogName(d.wilaya), d.latitude, d.longitude);
              const place = [catalogName(d.city), catalogName(d.wilaya)].filter(Boolean).join(" — ");
              return (
                <li key={d.id} className="glass p-4">
                  <div className="flex gap-3">
                    <DoctorAvatar doctor={d} />
                    <div className="min-w-0 flex-1">
                      <div>
                        <p className="break-words font-bold leading-snug text-slate-900">{t("د. ")}{d.firstName} {d.lastName}
                        </p>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{t(d.dutyEndsAt && new Date(d.dutyEndsAt) > new Date() ? "الطبيب متواجد الآن" : "لم يبدأ المداومة")}</p>
                        <span className="flex shrink-0 items-center gap-1 text-sm text-amber-600">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                          {d.avgRating > 0 ? d.avgRating.toFixed(1) : t("جديد")}
                          {typeof d.reviewsCount === "number" && <span className="text-xs text-slate-500">({d.reviewsCount}{t(" مراجعة)")}</span>}
                        </span>
                      </div>
                      <p className="text-sm text-primary-700">{catalogName(d.specialty)}</p>
                      {place && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{place}</span>
                        </p>
                      )}

                      {distance?.exact && (
                        <p className="mt-0.5 ps-[18px] text-xs font-semibold text-slate-600">{t("على بعد ")}{distance.km < 1 ? t("أقل من 1") : Math.round(distance.km * 10) / 10}{t(" كم ")}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <NextSlotPreview doctorId={d.id} />
                    <button
                      type="button"
                      onClick={() => onSelect(d)}
                      aria-label={t("احجز عند الطبيب {0} {1}", { "0": d.firstName, "1": d.lastName })}
                      className="btn-primary min-h-[44px] shrink-0 px-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                    >{t("احجز")}</button>
                  </div>
                  <details className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
                    <summary className="min-h-[48px] cursor-pointer font-semibold text-primary-700">{t("معلومات الطبيب")}</summary>
                    {d.clinic?.nameAr && <p className="mt-2 font-semibold">{d.clinic.nameAr}</p>}
                    {address && <p className="mt-2 break-words text-slate-600">{address}</p>}
                    {d.bio && <p className="mt-2 whitespace-pre-line break-words text-slate-600">{d.bio}</p>}
                    {d.yearsExperience > 0 && <p className="mt-2">{t("الخبرة: ")}{d.yearsExperience}{t(" سنوات")}</p>}
                    {d.languages?.length > 0 && <p className="mt-2">{t("اللغات: ")}{d.languages.join(t("، "))}</p>}
                    {d.consultationFee != null && Number.isFinite(d.consultationFee) && <p className="mt-2">{t("سعر الاستشارة المسجّل: ")}<bdi dir="ltr">{d.consultationFee.toLocaleString(getLocale())}</bdi>{t(" دج")}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(d.clinic?.phone || d.phone) && <a className="btn-outline" href={`tel:${d.clinic?.phone || d.phone}`}>{t("اتصل بالعيادة")}</a>}
                    {directions && <a className="btn-outline" href={directions} target="_blank" rel="noopener noreferrer">{t("الاتجاهات")}</a>}
                  </div>
                  </details>
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
