import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal, MapPin, LocateFixed } from "lucide-react";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { useDoctors } from "../hooks/useDoctors";
import { useGeolocation } from "../hooks/useGeolocation";
import { DoctorCard } from "../components/DoctorCard";
import { Spinner, EmptyState, ErrorState } from "../components/ui/States";
import { Pagination } from "../components/ui/Pagination";

const DISTANCE_OPTIONS = [
  { label: "أقل من 2 كم", value: 2 },
  { label: "أقل من 5 كم", value: 5 },
  { label: "أقل من 10 كم", value: 10 },
  { label: "أقل من 25 كم", value: 25 },
  { label: "كل النتائج", value: undefined },
];

export default function Doctors() {
  const [params, setParams] = useSearchParams();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const [showFilters, setShowFilters] = useState(false);
  const geo = useGeolocation();
  const [nearMeOn, setNearMeOn] = useState(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | undefined>(undefined);

  function toggleNearMe() {
    if (nearMeOn) {
      setNearMeOn(false);
      return;
    }
    setNearMeOn(true);
    if (geo.status === "idle" || geo.status === "denied") geo.request();
  }

  const filters = useMemo(
    () => ({
      specialtyId: params.get("specialtyId") ?? undefined,
      wilayaId: params.get("wilayaId") ?? undefined,
      gender: params.get("gender") ?? undefined,
      minRating: params.get("minRating") ? Number(params.get("minRating")) : undefined,
      q: params.get("q") ?? undefined,
      page: params.get("page") ? Number(params.get("page")) : 1,
      ...(nearMeOn && geo.coords ? { lat: geo.coords.lat, lng: geo.coords.lng, maxDistanceKm } : {}),
    }),
    [params, nearMeOn, geo.coords, maxDistanceKm]
  );

  const { data, isLoading, isError } = useDoctors(filters);
  const usingNearMe = nearMeOn && Boolean(geo.coords);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  }

  return (
    <div className="container-app py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-900">الأطباء</h1>
        <button className="btn-outline md:hidden" onClick={() => setShowFilters((s) => !s)}>
          <SlidersHorizontal className="h-4 w-4" />
          الفلاتر
        </button>
      </div>

      <div className="grid gap-8 md:grid-cols-[260px_1fr]">
        <aside className={`space-y-4 ${showFilters ? "block" : "hidden"} md:block`}>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-800">البحث</h3>
            <input
              className="input"
              placeholder="اسم الطبيب أو التخصص..."
              defaultValue={filters.q}
              onKeyDown={(e) => e.key === "Enter" && updateParam("q", (e.target as HTMLInputElement).value)}
            />
          </div>

          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <MapPin className="h-4 w-4" /> بالقرب مني
              </h3>
              <button
                type="button"
                onClick={toggleNearMe}
                className={`relative h-5 w-9 rounded-full transition ${nearMeOn ? "bg-primary-600" : "bg-slate-300"}`}
                aria-label="تفعيل البحث بالقرب مني"
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${nearMeOn ? "right-0.5" : "right-4"}`}
                />
              </button>
            </div>
            {nearMeOn && geo.status === "locating" && <p className="text-xs text-slate-500">جارٍ تحديد موقعك...</p>}
            {nearMeOn && geo.status === "denied" && (
              <div className="space-y-2">
                <p className="text-xs text-red-600">تعذّر الوصول إلى موقعك. تأكد من إذن الموقع في المتصفح.</p>
                <button
                  type="button"
                  onClick={geo.request}
                  className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  <LocateFixed className="h-3.5 w-3.5" /> إعادة المحاولة
                </button>
              </div>
            )}
            {nearMeOn && geo.status === "unsupported" && (
              <p className="text-xs text-red-600">متصفحك لا يدعم تحديد الموقع.</p>
            )}
            {usingNearMe && (
              <div className="flex flex-wrap gap-1.5">
                {DISTANCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setMaxDistanceKm(opt.value)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                      maxDistanceKm === opt.value ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-800">التخصص</h3>
            <select className="input" value={filters.specialtyId ?? ""} onChange={(e) => updateParam("specialtyId", e.target.value)}>
              <option value="">كل التخصصات</option>
              {specialties?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-800">الولاية</h3>
            <select className="input" value={filters.wilayaId ?? ""} onChange={(e) => updateParam("wilayaId", e.target.value)}>
              <option value="">كل الولايات</option>
              {wilayas?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-800">الجنس</h3>
            <select className="input" value={filters.gender ?? ""} onChange={(e) => updateParam("gender", e.target.value)}>
              <option value="">الكل</option>
              <option value="MALE">ذكر</option>
              <option value="FEMALE">أنثى</option>
            </select>
          </div>

          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-800">التقييم الأدنى</h3>
            <select className="input" value={filters.minRating ?? ""} onChange={(e) => updateParam("minRating", e.target.value)}>
              <option value="">الكل</option>
              <option value="4">4 نجوم فأكثر</option>
              <option value="3">3 نجوم فأكثر</option>
            </select>
          </div>
        </aside>

        <div>
          {isLoading && <Spinner />}
          {isError && <ErrorState message="تعذّر تحميل قائمة الأطباء. تأكد من تشغيل الخادم الخلفي (backend)." />}
          {!isLoading && !isError && data?.items.length === 0 && (
            <div className="space-y-3">
              <EmptyState
                title="لا يوجد أطباء ضمن هذا النطاق"
                description={usingNearMe ? "جرّب توسيع نطاق المسافة، أو تصفّح كل الأطباء." : "جرّب تعديل الفلاتر أو البحث بكلمات مختلفة."}
              />
              {usingNearMe && maxDistanceKm != null && (
                <button type="button" onClick={() => setMaxDistanceKm(undefined)} className="btn-outline mx-auto block">
                  عرض جميع الأطباء
                </button>
              )}
            </div>
          )}
          {!isLoading && !isError && data && data.items.length > 0 && (
            <>
              <p className="mb-4 text-sm text-slate-500">{data.total} طبيب متاح</p>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {data.items.map((d, i) => (
                  <DoctorCard key={d.id} doctor={d} showNextSlot={i < 20} />
                ))}
              </div>
              <Pagination page={data.page} totalPages={data.totalPages} onChange={goToPage} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
