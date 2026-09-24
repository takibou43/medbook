import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import clsx from "clsx";
import { MessageSquareText, Star } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { Pagination } from "../../components/ui/Pagination";

// تقييمات المرضى (طبيب فقط) — قراءة فقط: لا يوجد في الواجهة ولا في الخادم أي إمكانية لتعديل تقييم أو حذفه.
// البيانات من GET /api/doctor/reviews (الطبيب من الجلسة، واسم المريض مختصر: الاسم + الحرف الأول من اللقب).

interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  appointmentDate: string;
  appointmentTime: string;
  patientName: string;
}
interface ReviewsResponse {
  summary: { avgRating: number; reviewsCount: number; withCommentCount: number; distribution: Record<"1" | "2" | "3" | "4" | "5", number> };
  items: ReviewItem[];
  page: number;
  totalPages: number;
  total: number;
}

function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} من 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={clsx(size, n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200")} aria-hidden="true" />
      ))}
    </span>
  );
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("ar-DZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function DoctorReviews() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["doctor-reviews", page],
    queryFn: async () => (await api.get<{ data: ReviewsResponse }>("/doctor/reviews", { params: { page, pageSize: 20 } })).data.data,
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <Spinner />;
  if (isError || !data) return <ErrorState message={apiErrorMessage(error, "تعذّر تحميل التقييمات.")} />;

  const { summary } = data;
  const max = Math.max(1, ...Object.values(summary.distribution));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold text-slate-900">تقييمات المرضى</h1>

      <section className="card grid gap-4 p-4 sm:grid-cols-[auto_1fr] sm:gap-6 sm:p-6" aria-label="ملخص التقييمات">
        <div className="text-center sm:min-w-[140px]">
          <p className="text-4xl font-extrabold tabular-nums text-slate-900">{summary.avgRating.toFixed(1)}</p>
          <div className="mt-1 flex justify-center">
            <Stars value={summary.avgRating} size="h-5 w-5" />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {summary.reviewsCount > 0 ? `${summary.reviewsCount} تقييم` : "لا توجد تقييمات بعد"}
          </p>
          {summary.withCommentCount > 0 && <p className="text-xs text-slate-500">{summary.withCommentCount} منها بتعليق</p>}
        </div>

        <ul className="space-y-1.5" aria-label="توزيع النجوم">
          {(["5", "4", "3", "2", "1"] as const).map((k) => {
            const n = summary.distribution[k];
            return (
              <li key={k} className="flex items-center gap-2 text-sm">
                <span className="flex w-10 shrink-0 items-center gap-0.5 font-semibold text-slate-700">
                  {k} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                </span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-amber-400" style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-left tabular-nums text-slate-500">{n}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {data.items.length === 0 ? (
        <EmptyState title="لا توجد تقييمات بعد" description="تظهر هنا تقييمات المرضى بعد اكتمال مواعيدهم." />
      ) : (
        <ul className="space-y-3">
          {data.items.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stars value={r.rating} />
                <span className="text-xs text-slate-500">{formatDay(r.createdAt)}</span>
              </div>
              {r.comment ? (
                <p className="mt-2 flex gap-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">
                  <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>{r.comment}</span>
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-400">بدون تعليق</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                {r.patientName} · موعد {formatDay(r.appointmentDate)} الساعة {r.appointmentTime}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
    </div>
  );
}
