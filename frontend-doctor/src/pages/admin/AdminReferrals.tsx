import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
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
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("ar-DZ") : "—");

export default function AdminReferrals() {
  const [status, setStatus] = useState<DoctorReferralStatus | "">("");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["admin-referrals", status, page],
    queryFn: async () =>
      (await api.get<{ data: Paginated<AdminReferral> }>("/admin/referrals", { params: { status: status || undefined, page, pageSize: 50 } })).data.data,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">إحالات الأطباء</h1>
      <p className="text-sm text-slate-500">المكافأة تُمنح تلقائيًا عند توثيق الطبيب المُحال، مرة واحدة فقط لكل طبيب.</p>
      <div className="flex flex-wrap gap-2">
        {(["", "PENDING", "REWARDED", "REJECTED"] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => { setStatus(s); setPage(1); }}
            className={clsx("rounded-full border px-3 py-1.5 text-sm font-semibold", status === s ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-600")}
          >
            {s ? STATUS[s].label : "الكل"}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <p className="card p-4 text-sm text-red-600" role="alert">{apiErrorMessage(q.error)}</p>
      ) : (q.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="لا توجد إحالات" />
      ) : (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">الطبيب المُحيل</th>
                  <th className="px-4 py-3 font-semibold">الطبيب المُحال</th>
                  <th className="px-4 py-3 font-semibold">الحالة</th>
                  <th className="px-4 py-3 font-semibold">التسجيل</th>
                  <th className="px-4 py-3 font-semibold">المكافأة</th>
                  <th className="px-4 py-3 font-semibold">اشتراك المُحيل حتى</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data!.items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-semibold text-slate-800">د. {r.referrer.firstName} {r.referrer.lastName}</td>
                    <td className="px-4 py-3 text-slate-700">د. {r.referred.firstName} {r.referred.lastName}</td>
                    <td className="px-4 py-3"><span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS[r.status].cls)}>{STATUS[r.status].label}</span></td>
                    <td className="px-4 py-3 text-slate-600">{day(r.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{day(r.rewardedAt)}</td>
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
