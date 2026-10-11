import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { normalizeSettings, settingsPayload, type PrescriptionSettings } from "../lib/prescriptionSettings";
import type { PrescriptionTemplate } from "../lib/prescriptionTemplate";

/** إعدادات الوصفة + القالب الشخصي للطبيب الحالي؛ المفاتيح مرتبطة بالحساب فلا يتسرب شيء بين حسابين على نفس الجهاز. */
export function usePrescriptionSetup(uid: string) {
  const qc = useQueryClient();
  const settingsKey = ["prescription-settings", uid];
  const templateKey = ["prescription-template", uid];
  const settingsQ = useQuery({ queryKey: settingsKey, enabled: Boolean(uid), staleTime: 0, queryFn: async () => normalizeSettings((await api.get("/doctor/prescription-settings")).data.data) });
  const templateQ = useQuery({ queryKey: templateKey, enabled: Boolean(uid), staleTime: 0, queryFn: async () => ((await api.get("/doctor/prescription-template")).data.data ?? null) as PrescriptionTemplate | null });
  const saveSettings = useCallback(async (next: PrescriptionSettings) => {
    const res = await api.put("/doctor/prescription-settings", settingsPayload(next));
    const saved = normalizeSettings(res.data.data);
    qc.setQueryData(settingsKey, saved);
    return saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, uid]);
  const setTemplate = useCallback((value: PrescriptionTemplate | null) => { qc.setQueryData(templateKey, value); }, [qc, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    settings: settingsQ.data ?? null,
    template: templateQ.data ?? null,
    loading: Boolean(uid) && (settingsQ.isLoading || templateQ.isLoading),
    error: settingsQ.isError || templateQ.isError,
    refetch: () => { void settingsQ.refetch(); void templateQ.refetch(); },
    saveSettings,
    setTemplate,
  };
}
