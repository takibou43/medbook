import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { t } from "../i18n/locale";

/**
 * زر المداومة. `compact` (الافتراضي): الشارة الصغيرة أعلى الصفحات.
 * `hero`: الزر الكبير أعلى لوحة تحكم الطبيب — نفس الطلبات تمامًا (POST /shifts) دون أي منطق جديد.
 */
export function ShiftControl({ variant = "compact" }: { variant?: "compact" | "hero" } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = user?.role === "DOCTOR" || user?.role === "ASSISTANT";
  const state = useQuery({ queryKey: ["shift", user?.id], enabled,
    queryFn: async () => (await api.get<{ data: { active: boolean; endsAt: string | null; suggestedEndTime?: string | null } }>("/shifts")).data.data,
    refetchInterval: 10000,
  });
  const change = useMutation({ mutationFn: async (active: boolean) => api.post("/shifts", { active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shift"] }); qc.invalidateQueries({ queryKey: ["queue"] }); qc.invalidateQueries({ queryKey: ["assistants", "attendance"] }); },
  });
  useEffect(() => {
    if (user?.role !== "DOCTOR" || !state.data?.active) return;
    const timer = window.setInterval(() => {
      api.post("/shifts/heartbeat").then(() => qc.invalidateQueries({ queryKey: ["shift", user.id] })).catch(() => {});
    }, 20000);
    return () => window.clearInterval(timer);
  }, [user?.role, user?.id, state.data?.active, qc]);
  if (!enabled) return null;
  const active = state.data?.active && !!state.data.endsAt && new Date(state.data.endsAt) > new Date();
  const label = user?.role === "DOCTOR" ? t("المداومة") : t("المناوبة");
  if (variant === "hero") {
    const disabled = state.isLoading || state.isError || change.isPending;
    return <section aria-label={label} aria-live="polite"
      className={"card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 " + (active ? "border-emerald-200 bg-emerald-50/70" : "")}>
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className={"h-3 w-3 shrink-0 rounded-full " + (active ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]" : "bg-slate-400")} />
        <div className="min-w-0">
          <p className="text-base font-extrabold text-slate-900 sm:text-lg">{active ? t("العيادة مفتوحة") : t("العيادة مغلقة")}</p>
          <p className="text-sm text-slate-600">{active ? t("يظهر للمرضى أنك متواجد الآن، والطابور يعمل.") : t("ابدأ المداومة ليظهر للمرضى أنك متواجد ويعمل الطابور.")}</p>
        </div>
      </div>
      <button type="button" aria-pressed={!!active} disabled={disabled} onClick={() => change.mutate(!active)}
        className={"inline-flex min-h-[48px] w-full shrink-0 items-center justify-center gap-2 rounded-xl px-6 text-base font-bold transition disabled:opacity-50 sm:w-auto " + (active ? "border border-red-200 bg-white text-red-700 hover:bg-red-50" : "bg-emerald-600 text-white hover:bg-emerald-700")}>
        {change.isPending ? t("جارٍ التحديث…") : active ? t("إنهاء المداومة") : t("بدء المداومة")}
      </button>
      {(change.isError || state.isError) && <p role="alert" className="text-sm text-red-600 sm:basis-full">{t("تعذّر تحديث المداومة. حاول مرة أخرى.")}</p>}
    </section>;
  }
  return <div className="mb-2 inline-flex items-center gap-2 text-xs" aria-live="polite">
    <button aria-pressed={!!active} disabled={state.isLoading || state.isError || change.isPending}
      title={active ? t("إنهاء") + " " + label : t("بدء") + " " + label}
      className={"inline-flex items-center gap-2 rounded-full border px-3 py-1.5 disabled:opacity-50 " + (active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600")}
      onClick={() => change.mutate(!active)}>
      <span aria-hidden="true" className={"h-2 w-2 rounded-full " + (active ? "bg-emerald-500" : "bg-slate-400")} />
      {active ? t("إنهاء") : t("بدء")} {label}
    </button>
    {(change.isError || state.isError) && <span role="alert" className="text-red-600">{t("تعذّر تحديث المداومة. حاول مرة أخرى.")}</span>}
  </div>;
}
