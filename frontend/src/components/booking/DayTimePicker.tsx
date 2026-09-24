import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, Clock, X } from "lucide-react";
import { api } from "../../lib/api";
import { bookingError, formatLongDate } from "../../lib/booking";
import { InlineError } from "./StepParts";

// اختيار اختياري بالكامل لليوم (والوقت) داخل خطوة «الموعد». بلا اختيار يبقى الحجز كما كان: أول دور متاح.
// الأيام والأوقات من الخادم (GET /api/booking/availability) بنفس قواعد الحجز — والخادم يعيد التحقق لحظة التأكيد.

export interface DayTimeChoice {
  date: string; // YYYY-MM-DD
  startTime: string | null; // null = أول وقت متاح في ذلك اليوم
}

interface AvailableDay {
  date: string;
  freeCount: number;
  firstTime: string;
}

export const availabilityKey = (doctorId: string, date?: string) => (date ? ["availability", doctorId, date] : ["availability", doctorId]);

export function DayTimePicker({
  doctorId,
  value,
  onChange,
}: {
  doctorId: string;
  value: DayTimeChoice | null;
  onChange: (v: DayTimeChoice | null) => void;
}) {
  const [open, setOpen] = useState(Boolean(value));

  const days = useQuery({
    queryKey: availabilityKey(doctorId),
    queryFn: async () =>
      (await api.get<{ data: { days: AvailableDay[]; slotMinutes: number } }>("/booking/availability", { params: { doctorId } })).data.data,
    enabled: open,
    staleTime: 20000,
    refetchInterval: open ? 60000 : false,
  });

  const slots = useQuery({
    queryKey: availabilityKey(doctorId, value?.date),
    queryFn: async () =>
      (await api.get<{ data: { slots: string[] } }>("/booking/availability", { params: { doctorId, date: value!.date } })).data.data.slots,
    enabled: open && Boolean(value?.date),
    staleTime: 10000,
    refetchInterval: open && value?.date ? 30000 : false,
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-300 px-4 text-sm font-semibold text-primary-700 transition hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" /> أفضّل اختيار يوم أو وقت آخر (اختياري)
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  const dayList = days.data?.days ?? [];
  const timeList = slots.data ?? [];

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white/70 p-4" aria-labelledby="pick-day-title">
      <div className="flex items-center justify-between gap-2">
        <p id="pick-day-title" className="font-bold text-slate-800">
          اختر اليوم (اختياري)
        </p>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" /> العودة إلى أقرب موعد
        </button>
      </div>

      {days.isLoading ? (
        <p className="mt-3 text-sm text-slate-500" role="status">
          جارٍ تحميل الأيام المتاحة...
        </p>
      ) : days.isError ? (
        <div className="mt-3">
          <InlineError title="تعذّر تحميل الأيام المتاحة." message={bookingError(days.error).message} onRetry={() => days.refetch()} />
        </div>
      ) : dayList.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">لا توجد أيام متاحة لدى هذا الطبيب حاليًا.</p>
      ) : (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="الأيام المتاحة">
          {dayList.map((d) => {
            const selected = value?.date === d.date;
            return (
              <button
                key={d.date}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange({ date: d.date, startTime: null })}
                className={`min-h-[56px] shrink-0 rounded-xl border px-3 py-2 text-center text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                  selected ? "border-primary-600 bg-primary-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-primary-300"
                }`}
              >
                <span className="block font-bold">{formatLongDate(d.date)}</span>
                <span className={`block text-xs ${selected ? "text-primary-50" : "text-slate-500"}`}>{d.freeCount} وقت متاح</span>
              </button>
            );
          })}
        </div>
      )}

      {value?.date && (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Clock className="h-4 w-4" aria-hidden="true" /> الوقت (اختياري)
          </p>
          {slots.isLoading ? (
            <p className="mt-2 text-sm text-slate-500" role="status">
              جارٍ تحميل الأوقات...
            </p>
          ) : slots.isError ? (
            <div className="mt-2">
              <InlineError title="تعذّر تحميل الأوقات." message={bookingError(slots.error).message} onRetry={() => slots.refetch()} />
            </div>
          ) : timeList.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">لم يعد في هذا اليوم وقت متاح. اختر يومًا آخر.</p>
          ) : (
            <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6" role="listbox" aria-label="الأوقات المتاحة">
              <button
                type="button"
                role="option"
                aria-selected={value.startTime === null}
                onClick={() => onChange({ date: value.date, startTime: null })}
                className={`col-span-4 min-h-[44px] rounded-xl border px-2 text-sm font-semibold sm:col-span-6 ${
                  value.startTime === null ? "border-primary-600 bg-primary-50 text-primary-800" : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                أول وقت متاح في هذا اليوم ({timeList[0]})
              </button>
              {timeList.map((t) => {
                const selected = value.startTime === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    dir="ltr"
                    onClick={() => onChange({ date: value.date, startTime: t })}
                    className={`min-h-[44px] rounded-xl border text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                      selected ? "border-primary-600 bg-primary-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-primary-300"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
