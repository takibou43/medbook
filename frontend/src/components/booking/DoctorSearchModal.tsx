import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Star, X } from "lucide-react";
import { api } from "../../lib/api";
import { Doctor } from "../../types";
import { Input } from "../ui/Input";
import { Spinner, EmptyState } from "../ui/States";

interface Props {
  onClose: () => void;
  onSelect: (doctor: Doctor) => void;
}

// البحث المباشر عن طبيب بالاسم — خيار ثانوي (المسار الأساسي: التخصص ثم الطبيب).
// يبحث عبر كل الأطباء الموثّقين دون اختيار تخصص أولًا (GET /doctors?q=).
export function DoctorSearchModal({ onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["doctor-name-search", debounced],
    queryFn: async () => (await api.get<{ data: { items: Doctor[] } }>("/doctors", { params: { q: debounced, pageSize: 10 } })).data.data.items,
    enabled: debounced.length >= 2,
    retry: false,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-16" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-search-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p id="doctor-search-title" className="flex items-center gap-1.5 font-bold text-slate-800">
            <Search className="h-4 w-4" aria-hidden="true" /> ابحث عن طبيب بالاسم
          </p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <Input placeholder="اكتب اسم الطبيب..." aria-label="اسم الطبيب" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {isFetching && <Spinner label="جارٍ البحث..." />}
        {isError && !isFetching && (
          <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
            تعذّر البحث حاليًا.
            <button type="button" onClick={() => refetch()} className="ms-2 font-semibold underline">
              إعادة المحاولة
            </button>
          </div>
        )}
        {debounced.length >= 2 && !isFetching && !isError && (
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {data && data.length > 0 ? (
              data.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(d)}
                    className="flex min-h-[56px] w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-start transition hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <div>
                      <p className="font-semibold text-slate-800">
                        د. {d.firstName} {d.lastName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {d.specialty.nameAr} · {d.wilaya.nameAr}
                        {d.city ? ` — ${d.city.nameAr}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-sm text-amber-600">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                      {d.avgRating > 0 ? d.avgRating.toFixed(1) : "جديد"}
                    </div>
                  </button>
                </li>
              ))
            ) : (
              <EmptyState title="لا نتائج" description="جرّب اسمًا آخر." />
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
