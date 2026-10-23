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
    const on = !!active;
    return <div className="min-w-0 flex-1" aria-live="polite">
      <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => change.mutate(!on)}
        aria-label={on ? t("إنهاء المداومة") : t("بدء المداومة")}
        className="group flex w-full min-w-0 max-w-full items-center gap-3 rounded-2xl p-1 text-start outline-none transition focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-60">
        {/* المفتاح: مسار متدرّج + مقبض ينزلق (الاتجاه يتبع RTL/LTR تلقائيًا). */}
        <span aria-hidden="true" className={"relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 shadow-inner transition-colors duration-300 " + (on ? "bg-gradient-to-l from-emerald-400 to-teal-600" : "bg-slate-300 group-hover:bg-slate-400")}>
          <span className={"h-6 w-6 rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform duration-300 ease-out " + (on ? "ltr:translate-x-6 rtl:-translate-x-6" : "translate-x-0")} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-extrabold text-slate-900 sm:text-base">
            {on && <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>}
            <span className="truncate">{change.isPending ? t("جارٍ التحديث…") : on ? t("المداومة جارية") : t("بدء المداومة")}</span>
          </span>
          <span className="block truncate text-xs text-slate-500">{on ? t("العيادة مفتوحة الآن") : t("العيادة مغلقة حاليًا")}</span>
        </span>
      </button>
      {(change.isError || state.isError) && <p role="alert" className="mt-1 text-xs text-red-600">{t("تعذّر تحديث المداومة. حاول مرة أخرى.")}</p>}
    </div>;
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
