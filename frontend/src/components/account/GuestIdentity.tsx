import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { t } from "../../i18n/locale";
export function GuestIdentity({ userId }: { userId: string }) {
  const [code, setCode] = useState("");
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["guest-identity", userId], queryFn: async () => (await api.get<{ data: { verified: boolean; pending: boolean } }>("/patient/guest-identity")).data.data, retry: false });
  const send = useMutation({ mutationFn: () => api.post("/patient/guest-identity/code"), onSuccess: () => { qc.invalidateQueries({ queryKey: ["guest-identity"] }); } });
  const verify = useMutation({ mutationFn: () => api.post("/patient/guest-identity/verify", { code }), onSuccess: () => { setCode(""); qc.invalidateQueries({ queryKey: ["guest-identity"] }); } });
  return <section className="glass mt-4 p-4"><h2 className="font-bold">{t("ربط المواعيد السابقة")}</h2>
    <p className="mt-2 text-sm">{t("تحقق من هاتف حسابك، ثم اطلب من العيادة تأكيد هويتك لربط المواعيد المسجلة باسمك. مواعيد أفراد العائلة لا تُدمج تلقائيًا.")}</p>
    {state.data?.verified ? <p className="mt-2 text-emerald-700">{t("تم التحقق من الهاتف. راجع العيادة لتأكيد السجلات الخاصة بك.")}</p> : <>
      <button className="btn-outline mt-3" disabled={send.isPending} onClick={() => send.mutate()}>{t("إرسال رمز التحقق")}</button>
      {state.data?.pending && <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); verify.mutate(); }}>
        <input className="input" aria-label={t("رمز التحقق")} inputMode="numeric" dir="ltr" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} />
        <button className="btn-primary" disabled={verify.isPending}>{t("تأكيد")}</button>
      </form>}
    </>}
    {(send.isError || verify.isError) && <p role="alert" className="mt-2 text-red-700">{apiErrorMessage(send.error ?? verify.error)}</p>}
  </section>;
}
