import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { appointmentsCountAr, formatDzd, formatPercent } from "../../lib/doctorUi";

interface Summary { completedCount: number; grossDzd: number; doctorDuesDzd: number; clinicShareDzd: number; completedWithoutShare: number; cancelledCount: number; noShowCount: number; pendingCount: number }
interface Report {
  from: string; to: string; notes: string; totals: Summary;
  perDoctor: { doctorId: string; name: string; terms: { appointmentPriceDzd: number | null; doctorSharePercent: number | null; clinicSharePercent: number | null }; summary: Summary }[];
}

/** تقرير حسابي لمدير العيادة: مستحقات كل طبيب وحصة العيادة من المواعيد المكتملة فقط. لا دفع ولا تحويل. */
export default function ClinicFinanceReport() {
  useLanguage();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const range = (() => {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
  })();
  const query = useQuery({
    queryKey: ["clinic-finance", range.from, range.to],
    queryFn: async () => (await api.get<{ data: Report }>("/clinics/mine/finance", { params: range })).data.data,
    retry: false,
  });
  const r = query.data;
  return <section className="card space-y-3 p-5" aria-label={t("التقرير المالي للعيادة")}>
    <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-bold">{t("مستحقات الأطباء وحصة العيادة")}</h2>
      <label className="text-sm">{t("الشهر ")}<input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="rounded-lg border p-2" /></label></div>
    {query.isPending && <p>{t("جارٍ تحميل التقرير…")}</p>}
    {query.isError && <p role="alert" className="text-red-700">{apiErrorMessage(query.error, t("تعذر تحميل التقرير."))}</p>}
    {r && <>
      {r.totals.completedWithoutShare > 0 && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t("التقرير غير مكتمل: ")}{appointmentsCountAr(r.totals.completedWithoutShare)}{t(" مكتملة لم تُحسب مستحقاتها لعدم تحديد النسبة. حدّد نسبة الطبيب لتُحسب المواعيد القادمة.")}</p>}
      <p className="rounded-lg bg-slate-100 p-2 text-xs font-semibold text-slate-700">{t("المبالغ تقديرية للمواعيد المكتملة وليست إثباتًا لتحصيل الدفع.")}</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-start text-sm">
        <thead><tr className="border-b text-slate-500"><th className="p-2">{t("الطبيب")}</th><th className="p-2">{t("نسبة الطبيب")}</th><th className="p-2">{t("مكتملة")}</th><th className="p-2">{t("الإجمالي")}</th><th className="p-2">{t("مستحقات الطبيب")}</th><th className="p-2">{t("حصة العيادة")}</th><th className="p-2">{t("ملغاة / لم يحضر")}</th></tr></thead>
        <tbody>{r.perDoctor.map(d => <tr key={d.doctorId} className="border-b">
          <td className="p-2 font-semibold">{d.name}</td><td className="p-2 tabular-nums">{formatPercent(d.terms.doctorSharePercent)}</td>
          <td className="p-2 tabular-nums">{d.summary.completedCount}{d.summary.completedWithoutShare > 0 && <span className="mt-0.5 block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-900">{d.summary.completedWithoutShare}{t(" بلا نسبة")}</span>}</td>
          <td className="p-2 tabular-nums">{formatDzd(d.summary.grossDzd)}</td><td className="p-2 font-bold tabular-nums">{formatDzd(d.summary.doctorDuesDzd)}</td>
          <td className="p-2 font-bold tabular-nums">{formatDzd(d.summary.clinicShareDzd)}</td>
          <td className="p-2 tabular-nums">{d.summary.cancelledCount} / {d.summary.noShowCount}</td></tr>)}</tbody>
        <tfoot><tr className="font-bold"><td className="p-2">{t("المجموع")}</td><td /><td className="p-2 tabular-nums">{r.totals.completedCount}{r.totals.completedWithoutShare > 0 && <span className="mt-0.5 block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-900">{r.totals.completedWithoutShare}{t(" بلا نسبة")}</span>}</td><td className="p-2 tabular-nums">{formatDzd(r.totals.grossDzd)}</td><td className="p-2 tabular-nums">{formatDzd(r.totals.doctorDuesDzd)}</td><td className="p-2 tabular-nums">{formatDzd(r.totals.clinicShareDzd)}</td><td className="p-2 tabular-nums">{r.totals.cancelledCount} / {r.totals.noShowCount}</td></tr></tfoot>
      </table></div>
      <p className="text-xs leading-5 text-slate-600">{r.notes}</p>
      {r.totals.pendingCount > 0 && <p className="text-xs text-slate-500">{appointmentsCountAr(r.totals.pendingCount)}{t(" غير منتهية، لا تدخل في المبالغ حتى تكتمل.")}</p>}
    </>}
  </section>;
}
