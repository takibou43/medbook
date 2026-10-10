import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../lib/api";
import { t } from "../i18n/locale";
type Claim = { claimId: string; firstName: string; lastName: string; phone: string; appointments: { id: string; date: string; startTime: string }[] };
export function GuestClaimReview() {
  const qc = useQueryClient();
  const claims = useQuery({ queryKey: ["guest-claims"], queryFn: async () => (await api.get<{ data: Claim[] }>("/guest-claims")).data.data, refetchInterval: 30000 });
  const confirm = useMutation({ mutationFn: ({ claimId, appointmentId }: { claimId: string; appointmentId: string }) => api.post("/guest-claims/confirm", { claimId, appointmentId, identityConfirmed: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["guest-claims"] }); qc.invalidateQueries({ queryKey: ["appointments"] }); qc.invalidateQueries({ queryKey: ["queue"] }); },
  });
  if (!claims.data?.length) return null;
  return <section className="mb-3 rounded-xl border bg-white p-4"><h2 className="font-bold">{t("تأكيد هوية أصحاب الحسابات")}</h2>
    <p className="text-sm">{t("تحقق من هوية المريض شخصيًا قبل إتاحة مواعيده السابقة في الحساب. لا تؤكد سجلات أحد أفراد عائلته.")}</p>
    {claims.data.map(c => <div key={c.claimId} className="mt-3 border-t pt-3"><p>{c.firstName} {c.lastName} · <bdi>{c.phone}</bdi></p>
      {c.appointments.map(a => <button key={a.id} className="btn-outline me-2 mt-2" disabled={confirm.isPending} onClick={() => { if (window.confirm(t("هل تحققت شخصيًا أن هذا السجل يخص صاحب الحساب نفسه؟"))) confirm.mutate({ claimId: c.claimId, appointmentId: a.id }); }}>{t("تأكيد هوية وربط سجل")} {a.date.slice(0, 10)} · {a.startTime}</button>)}
    </div>)}
    {confirm.isError && <p role="alert" className="text-red-700">{apiErrorMessage(confirm.error)}</p>}
  </section>;
}
