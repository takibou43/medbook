import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { Input, Select } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
export default function ClinicTransferRequests() {
  useLanguage();
  const { user } = useAuth(); const qc = useQueryClient(); const [q, setQ] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const requests = useQuery({ queryKey: ["my-clinic-transfers", user?.id], queryFn: async () => (await api.get<{ data: { id: string; status: string; clinic: { nameAr: string } }[] }>("/clinics/transfers/mine")).data.data });
  const clinics = useQuery({ queryKey: ["transfer-clinics", q], queryFn: async () => (await api.get<{ data: { items: { id: string; nameAr: string }[] } }>("/clinics", { params: { q } })).data.data.items, enabled: !user?.doctor?.clinic });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const clinicId = new FormData(e.currentTarget).get("clinicId"); setBusy(true); setError("");
    try { await api.post("/clinics/transfers", { clinicId }); await qc.invalidateQueries({ queryKey: ["my-clinic-transfers"] }); } catch (err) { setError(apiErrorMessage(err, t("تعذر إرسال طلب الانتقال."))); } finally { setBusy(false); }
  }
  const pending = requests.data?.some(r => r.status === "PENDING");
  return <div className="card space-y-3 p-5"><h2 className="text-lg font-bold">{t("طلبات الانتقال إلى عيادة")}</h2>
    <p className="text-sm text-slate-600">{t("انتقال الطبيب المسجّل يحتاج موافقة الإدارة. يبقى ملفك واشتراكك الحاليان كما هما حتى الموافقة.")}</p>
    {error && <p role="alert" className="text-red-600">{t(error ?? "")}</p>}
    {requests.isError && <p role="alert">{apiErrorMessage(requests.error)}</p>}
    {requests.data?.map(r => <p key={r.id}>{r.clinic.nameAr} · {r.status === "PENDING" ? t("بانتظار موافقة الإدارة") : r.status === "ACCEPTED" ? t("تمت الموافقة") : t("مرفوض")}</p>)}
    {!user?.doctor?.clinic && !pending && <form onSubmit={submit} className="space-y-3">
      <Input label={t("البحث عن العيادة")} value={q} onChange={e => setQ(e.target.value)} />
      <Select name="clinicId" label={t("العيادة المطلوبة")} required><option value="">{t("اختر عيادة موثّقة ومفعّلة")}</option>{clinics.data?.map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}</Select>
      {clinics.isError && <p role="alert">{apiErrorMessage(clinics.error)}</p>}
      <Button type="submit" loading={busy} disabled={requests.isPending || requests.isError || clinics.isPending}>{t("إرسال طلب إلى الإدارة")}</Button>
    </form>}
  </div>;
}
