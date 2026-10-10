import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { t } from "../i18n/locale";

export function ShiftControl() {
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
