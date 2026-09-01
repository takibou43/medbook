import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../components/ui/Toast";
import { Pagination } from "../../components/ui/Pagination";
import { Role } from "../../types";

const ROLE_LABELS: Record<Role, string> = { PATIENT: "مريض", DOCTOR: "طبيب", ADMIN: "إدارة" };

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [page, setPage] = useState(1);
  const { showToast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", q, role, page],
    queryFn: async () => (await api.get("/admin/users", { params: { q: q || undefined, role: role || undefined, page } })).data.data,
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

      <div className="flex flex-wrap gap-3">
        <Input placeholder="بحث بالبريد أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select className="input max-w-[160px]" value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
          <option value="">كل الأدوار</option>
          <option value="PATIENT">مريض</option>
          <option value="DOCTOR">طبيب</option>
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
                  <tr key={u.id}>
                    <td className="px-4 py-3 text-slate-700">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{u.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{ROLE_LABELS[u.role as Role]}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {u.isActive ? "مفعّل" : "معطّل"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => toggleActive(u.id, u.isActive)}>
                          {u.isActive ? "تعطيل" : "تفعيل"}
                        </Button>
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
    </div>
  );
}
