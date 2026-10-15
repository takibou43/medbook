import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Star, ChevronDown } from "lucide-react";
import { api } from "../../lib/api";
import { Doctor } from "../../types";
import { RegionFilters } from "./RegionFilters";
import { Input } from "../ui/Input";
import { Spinner, EmptyState } from "../ui/States";

interface Props {
  onSelect: (doctor: Doctor) => void;
}

// بحث مباشر فوق التخصصات، دون نافذة أو اختيار تخصص مسبق.
// يبحث عبر كل الأطباء الموثّقين دون اختيار تخصص أولًا (GET /doctors?q=).
export function DoctorNameSearch({ onSelect }: Props) {
  useLanguage();
  const [wilayaId, setWilayaId] = useState("");
  const [cityId, setCityId] = useState("");
  const [regionOpen, setRegionOpen] = useState(false);
  const searching = (name: string) => name.length >= 2 || Boolean(wilayaId);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["doctor-name-search", debounced, wilayaId, cityId],
    queryFn: async ({ signal }) => (await api.get<{ data: { items: Doctor[] } }>("/doctors", { signal, params: { q: debounced, wilayaId: wilayaId || undefined, cityId: cityId || undefined, pageSize: 10 } })).data.data.items,
    enabled: searching(debounced),
    retry: false,
  });

  const waitingForName = query.trim() !== debounced;
  const active = searching(query.trim());
  const busy = active && (waitingForName || isFetching);

  return (
    <section aria-labelledby="doctor-search-title" className="mb-6 rounded-2xl border border-primary-100 bg-white p-4 shadow-sm sm:p-5">
      <h2 id="doctor-search-title" className="mb-3 flex items-center gap-2 font-bold text-slate-800">
        <Search className="h-5 w-5 text-primary-600" aria-hidden="true" />{t("ابحث عن طبيب بالاسم")}
      </h2>
      <Input type="search" placeholder={t("اكتب اسم الطبيب أو لقبه…")} aria-label={t("اسم الطبيب")} aria-describedby="doctor-search-hint" value={query} onChange={(e) => setQuery(e.target.value)} />
      <p id="doctor-search-hint" className="mt-2 text-sm text-slate-500">{t("اكتب حرفين على الأقل من الاسم أو اللقب.")}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500" aria-expanded={regionOpen} aria-controls="doctor-search-region" onClick={() => setRegionOpen(open => !open)}>
          {t("تحديد المنطقة — اختياري")}{wilayaId && <span className="h-2 w-2 rounded-full bg-primary-600" aria-label={t("فلتر المنطقة مفعّل")} />}<ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${regionOpen ? "rotate-180" : ""}`} />
        </button>
        {(wilayaId || cityId) && <button className="btn-outline" type="button" onClick={() => { setWilayaId(""); setCityId(""); }}>{t("مسح الفلاتر")}</button>}
      </div>
      <div id="doctor-search-region" hidden={!regionOpen}>{regionOpen && <RegionFilters wilayaId={wilayaId} cityId={cityId} onChange={(w,c) => { setWilayaId(w); setCityId(c); }} />}</div>
      <div aria-live="polite" aria-busy={busy}>
        {busy && <Spinner label={t("جارٍ البحث...")} />}
        {active && !busy && isError && (
          <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">{t("تعذّر البحث حاليًا. ")}<button type="button" onClick={() => refetch()} className="ms-2 font-semibold underline">{t("إعادة المحاولة ")}</button>
          </div>
        )}
        {active && !busy && !isError && (
          data && data.length > 0 ? (
            <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
              {data.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(d)}
                    className="flex min-h-[56px] w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-start transition hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <div className="min-w-0 flex-1 break-words">
                      <p className="font-semibold text-slate-800">{t("د. ")}{d.firstName} {d.lastName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {catalogName(d.specialty)} · {catalogName(d.wilaya)}
                        {d.city ? ` — ${d.city.nameAr}` : ""}
                      </p>
                      {d.clinic && <p className="text-xs text-primary-700">{d.clinic.nameAr}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="flex items-center gap-1 text-sm text-amber-600">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                      {d.avgRating > 0 ? d.avgRating.toFixed(1) : t("جديد")} {typeof d.reviewsCount === "number" && <span>({d.reviewsCount})</span>}
                    </span>
                    <span className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">{t("اختيار الموعد")}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
              <EmptyState title={t("لا نتائج")} description={t("جرّب اسمًا أو منطقة أخرى، أو امسح الفلاتر.")} />
          )
        )}
      </div>
    </section>
  );
}
