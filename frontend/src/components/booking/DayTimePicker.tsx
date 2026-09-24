import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Zap } from "lucide-react";
import { api } from "../../lib/api";

// اختيار يوم ووقت (اختياري): الوضع الافتراضي يبقى «أقرب دور يعيّنه النظام». الأوقات من
// GET /api/doctors/:id/availability — نفس الحساب الذي يعيده الخادم تحت القفل لحظة الحجز، ويشمل اليوم
// «أوقاتًا حية» إن كان الطبيب قد أنهى طابوره وما زال في دوامه. الخادم هو المرجع النهائي.

export interface PickedSlot {
  date: string;
  startTime: string;
}

const DAYS_AHEAD = 7;

// يوم الجزائر (UTC+1 ثابت) بصيغة YYYY-MM-DD بعد إزاحة offset أيام.
function algeriaDay(offset: number): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function dayLabel(iso: string, offset: number): string {
  if (offset === 0) return "اليوم";
  if (offset === 1) return "غدًا";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("ar-DZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function DayTimePicker({ doctorId, value, onChange }: { doctorId: string; value: PickedSlot | null; onChange: (v: PickedSlot | null) => void }) {
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => ({ iso: algeriaDay(i), label: dayLabel(algeriaDay(i), i) })), []);
  const [day, setDay] = useState<string>(value?.date ?? days[0].iso);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["doctor-availability", doctorId, day],
    queryFn: async () =>
      (await api.get<{ data: { date: string; slots: string[]; live?: boolean } }>(`/doctors/${doctorId}/availability`, { params: { date: day } })).data.data,
    // التوفر يتغيّر مع الطابور والوقت — تحديث خفيف أثناء العرض.
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-white/70 p-3" aria-label="اختيار يوم ووقت">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="اليوم">
        {days.map((d) => (
          <button
            key={d.iso}
            type="button"
            role="tab"
            aria-selected={day === d.iso}
            onClick={() => {
              setDay(d.iso);
              if (value && value.date !== d.iso) onChange(null);
            }}
            className={clsx(
              "min-h-[40px] shrink-0 rounded-xl border px-3 text-sm font-semibold transition",
              day === d.iso ? "border-primary-600 bg-primary-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-primary-300"
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      {data?.live && (
        <p className="flex items-center gap-1.5 rounded-xl bg-green-50 p-2 text-xs font-semibold text-green-800">
          <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> الطبيب أنهى مرضى الطابور ومتاح الآن — أوقات جديدة اليوم.
        </p>
      )}

      {isFetching && !data ? (
        <p className="py-4 text-center text-sm text-slate-500">جارٍ تحميل الأوقات...</p>
      ) : isError ? (
        <p className="py-3 text-center text-sm text-red-600">
          تعذّر تحميل الأوقات.{" "}
          <button type="button" className="font-semibold underline" onClick={() => refetch()}>
            إعادة المحاولة
          </button>
        </p>
      ) : !data || data.slots.length === 0 ? (
        <p className="py-3 text-center text-sm text-slate-500">لا توجد أوقات متاحة في هذا اليوم.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="الوقت">
          {data.slots.map((t) => {
            const selected = value?.date === day && value.startTime === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(selected ? null : { date: day, startTime: t })}
                dir="ltr"
                className={clsx(
                  "min-h-[44px] rounded-xl border text-sm font-bold tabular-nums transition",
                  selected ? "border-primary-600 bg-primary-600 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-primary-300"
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
