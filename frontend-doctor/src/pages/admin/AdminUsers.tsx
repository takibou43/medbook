import { AdminResults, AdminActions } from "../../components/admin/AdminUI";
import { useAdminListParams } from "../../hooks/useAdminListParams";
import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../components/ui/Toast";
import { Pagination } from "../../components/ui/Pagination";
import { Role } from "../../types";
import { BlockPatientDialog, BlockTarget } from "../../components/BlockPatientDialog";

const ROLE_LABELS: Record<Role, string> = { PATIENT: "مريض", DOCTOR: "طبيب", ADMIN: "إدارة", ASSISTANT: "مساعد", CLINIC_OWNER: "صاحب عيادة" };

export default function AdminUsers() {
  const { params, q, setQ, search, page, setPage, update, clear } = useAdminListParams();
  const id = params.get("id");
  const role = params.get("role") && params.get("role")! in ROLE_LABELS ? params.get("role") as Role : "";
  const setRole = (value: string) => update("role", value);
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [blockTarget, setBlockTarget] = useState<{ t: BlockTarget; mode: "block" | "unblock" } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-users", search, role, page, id],
    queryFn: async ({ signal }) => (await api.get("/admin/users", { signal, params: { id: id || undefined, q: search || undefined, role: role || undefined, page } })).data.data,
  });

  async function toggleActive(id: string, isActive: boolean) {
    try {
      await api.patch(`/admin/users/${id}/${isActive ? "deactivate" : "activate"}`);
      showToast(isActive ? "تم تعطيل الحساب." : "تم تفعيل الحساب.", "success");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  async function remove(id: string) {
    if (!confirm("هل أنت متأكد من حذف هذا المستخدم؟ لا يمكن التراجع عن هذا الإجراء.")) return;
    try {
      await api.delete(`/admin/users/${id}`);
      showToast("تم الحذف.", "success");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  const actions = (u: any) => (<AdminActions label={"المستخدم " + u.email}>
                        <Button variant="outline" onClick={() => toggleActive(u.id, u.isActive)}>
                          {u.isActive ? "تعطيل" : "تفعيل"}
                        </Button>
                        {u.role === "PATIENT" && u.patient && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              setBlockTarget({
                                t: { patientId: u.patient.id, name: `${u.patient.firstName} ${u.patient.lastName}`.trim(), email: u.email },
                                mode: u.patient.blocks?.length > 0 ? "unblock" : "block",
                              })
                            }
                          >
                            {u.patient.blocks?.length > 0 ? "رفع الحظر" : "حظر المريض"}
                          </Button>
                        )}
                        <Button variant="danger" onClick={() => remove(u.id)}>
                          حذف
                        </Button>
                      </AdminActions>);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">إدارة المستخدمين</h1>
      {id && <p className="text-sm text-primary-700" role="status">عرض السجل المحدد من الرابط</p>}

      <div className="flex flex-wrap gap-3">
        <Input label="بحث عن مستخدم" placeholder="بحث بالبريد أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select aria-label="دور المستخدم" className="input max-w-[160px]" value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
          <option value="">كل الأدوار</option>
          <option value="PATIENT">مريض</option>
          <option value="DOCTOR">طبيب</option>
          <option value="ASSISTANT">مساعد</option>
          <option value="ADMIN">إدارة</option>
        </select>
      </div>

      <AdminResults total={data?.total} filtered={!!(q || id || role)} onClear={clear} />

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} onRetry={() => void refetch()} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-3 md:hidden">
            {data.items.map((u: any) => <article key={u.id} aria-label={"حساب " + u.email} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-[140px] flex-1 break-words font-bold text-slate-900"><bdi>{[u.patient?.firstName ?? u.doctor?.firstName, u.patient?.lastName ?? u.doctor?.lastName].filter(Boolean).join(" ") || u.email}</bdi></h2>{actions(u)}</div>
              <p className="break-all text-sm text-slate-600"><bdi dir="ltr">{u.email}</bdi></p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm"><dt className="text-slate-600">الهاتف</dt><dd><bdi dir="ltr">{u.phone ?? "—"}</bdi></dd><dt className="text-slate-600">الدور</dt><dd>{ROLE_LABELS[u.role as Role]}</dd></dl>
              <div className="flex flex-wrap gap-2"><span className={"badge " + (u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>{u.isActive ? "مفعّل" : "معطّل"}</span>{u.patient?.blocks?.length > 0 && <span className="badge bg-red-100 text-red-700">محظور من الحجز</span>}</div>
            </article>)}
          </div>
          <div className="card hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">البريد الإلكتروني</th>
                  <th className="px-4 py-3 font-semibold">الهاتف</th>
                  <th className="px-4 py-3 font-semibold">الدور</th>
                  <th className="px-4 py-3 font-semibold">الحالة</th>
                  <th className="px-4 py-3 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u: any) => (
                  <tr key={u.id} className={id === u.id ? "bg-primary-50" : undefined}>
                    <td className="px-4 py-3 text-slate-700" dir="ltr">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600" dir="ltr">{u.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{ROLE_LABELS[u.role as Role]}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {u.isActive ? "مفعّل" : "معطّل"}
                      </span>
                      {u.patient?.blocks?.length > 0 && <span className="badge mr-1 bg-red-100 text-red-700">محظور من الحجز</span>}
                    </td>
                    <td className="px-4 py-3">
                      {actions(u)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState title={!!(q || id || role) ? "لا نتائج مطابقة" : "لا يوجد مستخدمون"} description={!!(q || id || role) ? "جرّب تغيير البحث أو مسح الفلاتر." : undefined} />
      )}

      <BlockPatientDialog target={blockTarget?.t ?? null} mode={blockTarget?.mode ?? "block"} onClose={() => setBlockTarget(null)} />
    </div>
  );
}
