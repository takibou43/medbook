import { useAdminListParams } from "../../hooks/useAdminListParams";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { Input } from "../../components/ui/Input";
import { Pagination } from "../../components/ui/Pagination";

const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "today", label: "مواعيد اليوم" },
  { key: "completed", label: "المكتملة" },
  { key: "cancelled", label: "الملغاة" },
] as const;

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "قيد الانتظار", cls: "bg-slate-100 text-slate-700" },
  CONFIRMED: { text: "مؤكد", cls: "bg-blue-100 text-blue-700" },
  IN_PROGRESS: { text: "جارٍ", cls: "bg-primary-100 text-primary-700" },
  LATE: { text: "متأخر", cls: "bg-amber-100 text-amber-700" },
  COMPLETED: { text: "مكتمل", cls: "bg-green-100 text-green-700" },
  CANCELLED: { text: "ملغى", cls: "bg-red-100 text-red-700" },
  NO_SHOW: { text: "لم يحضر", cls: "bg-orange-100 text-orange-700" },
};

export default function AdminAppointments() {
  const { params, q, setQ, search: dq, page, setPage, update } = useAdminListParams();
  const id = params.get("id");
  const filter = FILTERS.find((f) => f.key === params.get("filter"))?.key ?? "all";

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-appointments", filter, dq, page, id],
    queryFn: async ({ signal }) => (await api.get("/admin/appointments", { signal, params: { id: id || undefined, filter, q: dq || undefined, page } })).data.data,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">المواعيد</h1>
      {id && <p className="text-sm text-primary-700" role="status">عرض الموعد المحدد من الرابط</p>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                update("filter", f.key === "all" ? "" : f.key);

              }}
              className={clsx("rounded-lg px-3 py-1.5 text-sm font-semibold transition", filter === f.key ? "bg-white text-primary-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input label="بحث باسم الطبيب أو المستفيد" placeholder="بحث باسم الطبيب أو المريض..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
      </div>

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">التاريخ</th>
                  <th className="px-4 py-3 font-semibold">الوقت</th>
                  <th className="px-4 py-3 font-semibold">الطبيب</th>
                  <th className="px-4 py-3 font-semibold">المريض</th>
                  <th className="px-4 py-3 font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((a: any) => {
                  const st = STATUS_LABEL[a.status] ?? { text: a.status, cls: "bg-slate-100 text-slate-700" };
                  const patient = a.familyMember ? `${a.familyMember.firstName} ${a.familyMember.lastName}` : a.familyMemberId ? "فرد عائلة (الاسم غير متاح)" : a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : `${a.guestFirstName ?? ""} ${a.guestLastName ?? ""}`.trim() || "—";
                  return (
                    <tr key={a.id} className={clsx("hover:bg-slate-50", id === a.id && "bg-primary-50")}>
                      <td className="px-4 py-3 text-slate-700">{new Date(a.date).toLocaleDateString("ar-DZ", { timeZone: "UTC" })}</td>
                      <td className="px-4 py-3 text-slate-600" dir="ltr">{a.startTime}</td>
                      <td className="px-4 py-3 text-slate-700">د. {a.doctor.firstName} {a.doctor.lastName}</td>
                      <td className="px-4 py-3 text-slate-600" dir="auto">{patient}</td>
                      <td className="px-4 py-3"><span className={clsx("badge", st.cls)}>{st.text}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState title="لا توجد مواعيد" description="لا مواعيد مطابقة لهذا الفلتر." />
      )}
    </div>
  );
}
