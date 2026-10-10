import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLocale } from "../../i18n/locale.ts";
import { Link } from "react-router-dom";
import { useAdminListParams } from "../../hooks/useAdminListParams";
import { AdminResults } from "../../components/admin/AdminUI";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { Pagination } from "../../components/ui/Pagination";
import type { AdminReferral, DoctorReferralStatus, Paginated } from "../../types";

/**
 * إحالات الأطباء — عرض فقط. المكافأة (30 يومًا للمُحيل) تُمنح تلقائيًا ومرة واحدة داخل معاملة توثيق
 * الطبيب المُحال من صفحة «الأطباء»؛ لا يوجد هنا أي زر مكافأة يدوي يمكن أن يؤدي إلى التكرار.
 */
const STATUS: Record<DoctorReferralStatus, { label: string; cls: string }> = {
  PENDING: { label: "في انتظار التوثيق", cls: "bg-amber-50 text-amber-800" },
  QUALIFIED: { label: "مؤهلة", cls: "bg-primary-50 text-primary-800" },
  REWARDED: { label: "مُنحت 30 يومًا", cls: "bg-emerald-50 text-emerald-800" },
  REJECTED: { label: "رُفض التوثيق", cls: "bg-slate-100 text-slate-600" },
};
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(getLocale()) : "—");

export default function AdminReferrals() {
  useLanguage();
  const { params, page, setPage, update, clear } = useAdminListParams();
  const status = params.get("status") && params.get("status")! in STATUS ? params.get("status") as DoctorReferralStatus : "";
  const setStatus = (value: string) => update("status", value);
  const q = useQuery({
    queryKey: ["admin-referrals", status, page],
    queryFn: async ({ signal }) =>
      (await api.get<{ data: Paginated<AdminReferral> }>("/admin/referrals", { signal, params: { status: status || undefined, page, pageSize: 50 } })).data.data,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">{t("إحالات الأطباء")}</h1>
      <p className="text-sm text-slate-500">{t("المكافأة تُمنح تلقائيًا عند توثيق الطبيب المُحال، مرة واحدة فقط لكل طبيب.")}</p>
      <div className="flex flex-wrap gap-2">
        {(["", "PENDING", "REWARDED", "REJECTED"] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            aria-pressed={status === s}
            onClick={() => { setStatus(s); }}
            className={clsx("min-h-11 rounded-full border px-3 py-1.5 text-sm font-semibold", status === s ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-600")}
          >
            {s ? STATUS[s].label : t("الكل")}
          </button>
        ))}
      </div>
      <AdminResults total={q.data?.total} filtered={!!status} onClear={clear} />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState message={apiErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (q.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={status ? t("لا نتائج مطابقة") : t("لا توجد إحالات")} />
      ) : (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-start text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("الطبيب المُحيل")}</th>
                  <th className="px-4 py-3 font-semibold">{t("الطبيب المُحال")}</th>
                  <th className="px-4 py-3 font-semibold">{t("الحالة")}</th>
                  <th className="px-4 py-3 font-semibold">{t("التسجيل")}</th>
                  <th className="px-4 py-3 font-semibold">{t("المكافأة")}</th>
                  <th className="px-4 py-3 font-semibold">{t("اشتراك المُحيل حتى")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data!.items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{t("د. ")}{r.referrer.firstName} {r.referrer.lastName}</td>
                    <td className="px-4 py-3 text-slate-700">{t("د. ")}{r.referred.firstName} {r.referred.lastName}</td>
                    <td className="px-4 py-3"><span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS[r.status].cls)}>{t(STATUS[r.status].label ?? "")}</span>{r.status==="REJECTED"&&<p className="mt-2 text-xs">{t("السبب: ")}{r.rejectionReason??t("غير مسجل")} · {day(r.rejectionAt)}</p>}</td>
                    <td className="px-4 py-3 text-slate-600">{day(r.createdAt)}<p className="text-xs">{t("التوثيق: ")}{day(r.qualifiedAt)}</p></td>
                    <td className="px-4 py-3 text-slate-600">{day(r.rewardedAt)}<p className="text-xs">{t("المكافأة: ")}{r.rewardDays}{t(" يومًا")}</p>{r.rewardClinicId&&<Link className="text-primary-700 underline" to={"/admin/clinics?id="+r.rewardClinicId}>{t("اشتراك العيادة المستفيد")}</Link>}</td>
                    <td className="px-4 py-3 text-slate-600">{day(r.referrer.subscriptionExpiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.data!.totalPages > 1 && <Pagination page={page} totalPages={q.data!.totalPages} onChange={setPage} />}
        </>
      )}
    </div>
  );
}
