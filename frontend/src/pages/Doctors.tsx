import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { useSpecialties, useWilayas } from "../hooks/useCatalog";
import { useDoctors } from "../hooks/useDoctors";
import { DoctorCard } from "../components/DoctorCard";
import { Spinner, EmptyState, ErrorState } from "../components/ui/States";
import { Pagination } from "../components/ui/Pagination";

export default function Doctors() {
  const [params, setParams] = useSearchParams();
  const { data: specialties } = useSpecialties();
  const { data: wilayas } = useWilayas();
  const [showFilters, setShowFilters] = useState(false);

  const filters = useMemo(
    () => ({
      specialtyId: params.get("specialtyId") ?? undefined,
      wilayaId: params.get("wilayaId") ?? undefined,
      gender: params.get("gender") ?? undefined,
      minRating: params.get("minRating") ? Number(params.get("minRating")) : undefined,
      q: params.get("q") ?? undefined,
      page: params.get("page") ? Number(params.get("page")) : 1,
    }),
    [params]
  );

  const { data, isLoading, isError } = useDoctors(filters);

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
            <EmptyState title="لا يوجد أطباء مطابقون" description="جرّب تعديل الفلاتر أو البحث بكلمات مختلفة." />
          )}
          {!isLoading && !isError && data && data.items.length > 0 && (
            <>
              <p className="mb-4 text-sm text-slate-500">{data.total} طبيب متاح</p>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {data.items.map((d) => (
                  <DoctorCard key={d.id} doctor={d} />
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
