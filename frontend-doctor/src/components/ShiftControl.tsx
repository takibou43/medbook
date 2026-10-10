import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { t } from "../i18n/locale";

export function ShiftControl() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [endTime, setEndTime] = useState("18:00");
  const enabled = user?.role === "DOCTOR" || user?.role === "ASSISTANT";
  const state = useQuery({ queryKey: ["shift", user?.id], enabled,
    queryFn: async () => (await api.get<{ data: { active: boolean; endsAt: string | null; suggestedEndTime?: string | null } }>("/shifts")).data.data,
    refetchInterval: 10000,
  });
  useEffect(() => { if (state.data?.suggestedEndTime) setEndTime(state.data.suggestedEndTime); }, [state.data?.suggestedEndTime]);
  const change = useMutation({ mutationFn: async (value: string | null) => api.post("/shifts", { endTime: value }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shift"] }); qc.invalidateQueries({ queryKey: ["queue"] }); qc.invalidateQueries({ queryKey: ["assistants", "attendance"] }); },
  });
  if (!enabled) return null;
  const active = state.data?.active && !!state.data.endsAt && new Date(state.data.endsAt) > new Date();
  const label = user?.role === "DOCTOR" ? t("المداومة") : t("المناوبة");
  return <div className="mb-4 rounded-xl border bg-white p-3 text-sm" aria-live="polite">
    <div className="flex flex-wrap items-center gap-3">
      <span>{label}: {active ? t("نشطة") : t("غير نشطة")}</span>
      {!active && <label>{t("وقت النهاية")} <input aria-label={t("وقت نهاية المناوبة")} type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="rounded border p-1" /></label>}
      <button disabled={state.isLoading || state.isError || change.isPending} className="rounded bg-primary-600 px-3 py-2 text-white disabled:opacity-50" onClick={() => change.mutate(active ? null : endTime)}>
        {active ? t("إنهاء") : t("بدء")} {label}
      </button>
      <span className="text-xs text-slate-500">{t("تنتهي تلقائيًا في الوقت المحدد، وتبدأ يدويًا كل مرة.")}</span>
    </div>
    {(change.isError || state.isError) && <p role="alert" className="mt-2 text-red-600">{t("تعذّر تحديث المناوبة. تحقق من وقت النهاية واتصالك.")}</p>}
  </div>;
}
