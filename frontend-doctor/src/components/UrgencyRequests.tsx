import { useQueue } from "../hooks/useQueue";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../lib/api";
import { beneficiaryName } from "../lib/appointmentPeople";
import { t } from "../i18n/locale";
import { useState } from "react";
import { useAttendanceActions } from "../hooks/useAttendanceActions";

export function UrgencyRequests() {
  const queue = useQueue();
  const qc = useQueryClient();
  const canReceive = useAttendanceActions();
  const [patientId, setPatientId] = useState("");
  const [reason, setReason] = useState("");
  const request = useMutation({ mutationFn: async () => api.post(`/appointments/${patientId}/urgency`, { reason }),
    onSuccess: () => { setPatientId(""); setReason(""); qc.invalidateQueries({ queryKey: ["queue"] }); },
  });
  const decide = useMutation({ mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
    api.post(`/appointments/${id}/urgency/decision`, { approve }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["queue"] }); qc.invalidateQueries({ queryKey: ["appointments"] }); },
  });
  const waiting = queue.data?.ordered ?? [...(queue.data?.waiting ?? []), ...(queue.data?.late ?? [])];
  const requests = waiting.filter(a => a.urgencyStatus === "REQUESTED");
  const available = waiting.filter(a => a.arrivedAt && (!a.urgencyStatus || a.urgencyStatus === "NONE"));
  if (!requests.length && (!canReceive || !available.length)) return null;
  return <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label={t("طلبات الحالات المستعجلة")}>
    <h2 className="font-bold">{t("طلبات الحالات المستعجلة")}</h2>
    <p className="text-sm">{t("التقديم للنداء التالي ولا يوقف الاستشارة الجارية.")}</p>
    {canReceive && available.length > 0 && <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); request.mutate(); }}>
      <select className="input" aria-label={t("المريض")} required value={patientId} onChange={e => setPatientId(e.target.value)}>
        <option value="">{t("المريض")}</option>
        {available.map(a => <option value={a.id} key={a.id}>{beneficiaryName(a)} · {a.startTime}</option>)}
      </select>
      <input className="input" aria-label={t("سبب طلب تقديم الحالة المستعجلة")} placeholder={t("سبب طلب تقديم الحالة المستعجلة")} required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
      <button className="btn-outline" disabled={request.isPending || !reason.trim()}>{t("طلب تقديم حالة مستعجلة")}</button>
    </form>}
    {requests.map(a => <div key={a.id} className="mt-3 border-t border-amber-200 pt-3">
      <p className="font-semibold">{beneficiaryName(a)} · {a.startTime}</p>
      <p className="whitespace-pre-wrap text-sm">{a.urgencyReason}</p>
      <div className="mt-2 flex gap-2">
        <button className="btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: true })}>{t("الموافقة على التقديم")}</button>
        <button className="btn-outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: false })}>{t("إبقاء الترتيب")}</button>
      </div>
    </div>)}
    {decide.isError && <p role="alert" className="mt-2 text-red-700">{apiErrorMessage(decide.error)}</p>}
    {request.isError && <p role="alert" className="mt-2 text-red-700">{apiErrorMessage(request.error)}</p>}
  </section>;
}
