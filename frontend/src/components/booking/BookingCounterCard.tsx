import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { api } from "../../lib/api";
import { counterCardText } from "../../lib/bookingStats";
import type { BookingStats } from "../../types";

/**
 * عدّاد الحجوزات الشهري العلني. النص من الخادم كما هو (رقم فعلي ≥ 10، أو عبارة عامة، أو دعوة للحجز).
 * لا رقم ثابت في الواجهة. عند التحميل أو الفشل تُخفى البطاقة فقط — الحجز لا يتأثر.
 */
export function BookingCounterCard({ wilayaId }: { wilayaId?: string | null }) {
  const q = useQuery({
    queryKey: ["public-booking-stats", wilayaId ?? "national"],
    queryFn: async () =>
      (await api.get<{ data: BookingStats }>("/public/stats/bookings", { params: wilayaId ? { wilayaId } : undefined })).data.data,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const text = counterCardText({ data: q.data, isError: q.isError, isLoading: q.isLoading });
  if (!text) return null;
  return (
    <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-primary-100 bg-primary-50/70 px-4 py-2.5 text-center text-sm font-semibold text-primary-800" role="status">
      <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
