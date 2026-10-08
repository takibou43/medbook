import { useAdminListParams } from "../../hooks/useAdminListParams";
import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../components/ui/Toast";
import { Pagination } from "../../components/ui/Pagination";
import { Role } from "../../types";
import { BlockPatientDialog, BlockTarget } from "../../components/BlockPatientDialog";

const ROLE_LABELS: Record<Role, string> = { PATIENT: "مريض", DOCTOR: "طبيب", ADMIN: "إدارة", ASSISTANT: "مساعد", CLINIC_OWNER: "صاحب عيادة" };

export default function AdminUsers() {
  const { params, q, setQ, search, page, setPage, update } = useAdminListParams();
  const id = params.get("id");
  const role = params.get("role") && params.get("role")! in ROLE_LABELS ? params.get("role") as Role : "";
  const setRole = (value: string) => update("role", value);
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [blockTarget, setBlockTarget] = useState<{ t: BlockTarget; mode: "block" | "unblock" } | null>(null);

  const { data, isLoading } = useQuery({
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

      {isLoading ? (
        <Spinner />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="card overflow-x-auto p-0">
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
                      <div className="flex gap-2">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState title="لا يوجد مستخدمون" />
      )}

      <BlockPatientDialog target={blockTarget?.t ?? null} mode={blockTarget?.mode ?? "block"} onClose={() => setBlockTarget(null)} />
    </div>
  );
}
