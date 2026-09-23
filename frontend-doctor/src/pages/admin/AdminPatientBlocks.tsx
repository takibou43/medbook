import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Pagination } from "../../components/ui/Pagination";
import { BlockPatientDialog, BlockTarget } from "../../components/BlockPatientDialog";

interface BlockRow {
  id: string;
  patientId: string;
  patientName: string;
  email: string;
  phone: string | null;
  reason: string | null;
  blockType: "MANUAL" | "AUTOMATIC";
  noShowCount: number | null;
  blockedAt: string;
  blockedByEmail: string | null;
  unblockedAt: string | null;
  unblockedByEmail: string | null;
  active: boolean;
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("ar-DZ", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function AdminPatientBlocks() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"active" | "all">("active");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<BlockTarget | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-patient-blocks", q, status, page],
    queryFn: async () =>
      (await api.get("/admin/patient-blocks", { params: { q: q.trim() || undefined, status, page } })).data.data as {
        items: BlockRow[];
        page: number;
        totalPages: number;
      },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">المرضى المحظورون</h1>
        <p className="mt-1 text-sm text-slate-500">المريض المحظور لا يستطيع إنشاء حجوزات جديدة فقط؛ حجوزاته وحسابه تبقى كما هي. الحظر اليدوي: «المستخدمون» ← مريض ← «حظر». الحظر التلقائي: 3 غيابات خلال 7 أيام.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input placeholder="بحث بالاسم أو البريد أو الهاتف..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
        <select className="input max-w-[180px]" value={status} onChange={(e) => { setStatus(e.target.value as "active" | "all"); setPage(1); }}>
          <option value="active">المحظورون حاليًا</option>
          <option value="all">كل السجل (مع الملغى)</option>
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
                  <th className="px-4 py-3 font-semibold">المريض</th>
                  <th className="px-4 py-3 font-semibold">الهاتف</th>
                  <th className="px-4 py-3 font-semibold">تاريخ الحظر</th>
                  <th className="px-4 py-3 font-semibold">النوع</th>
                  <th className="px-4 py-3 font-semibold">السبب</th>
                  <th className="px-4 py-3 font-semibold">بواسطة</th>
                  <th className="px-4 py-3 font-semibold">الحالة</th>
                  <th className="px-4 py-3 font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{b.patientName}</p>
                      <p className="text-xs text-slate-500" dir="ltr">{b.email}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600" dir="ltr">{b.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{fmt(b.blockedAt)}</td>
                    <td className="px-4 py-3">
                      {b.blockType === "AUTOMATIC" ? (
                        <span className="badge bg-amber-100 text-amber-800">تلقائي</span>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-700">يدوي</span>
                      )}
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-slate-600">
                      {b.reason ?? "—"}
                      {b.blockType === "AUTOMATIC" && b.noShowCount != null && (
                        <p className="mt-1 text-xs text-slate-500">عدد الغيابات: {b.noShowCount} خلال 7 أيام</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500" dir="ltr">
                      {b.blockType === "AUTOMATIC" ? <span dir="rtl">النظام</span> : b.blockedByEmail ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {b.active ? (
                        <span className="badge bg-red-100 text-red-700">محظور</span>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-600" title={b.unblockedByEmail ?? undefined}>
                          رُفع {fmt(b.unblockedAt)}
                        </span>
                      )}
                      {!b.active && b.unblockedByEmail && (
                        <p className="mt-1 text-xs text-slate-500" dir="ltr">{b.unblockedByEmail}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {b.active && (
                        <Button variant="outline" onClick={() => setTarget({ patientId: b.patientId, name: b.patientName, email: b.email })}>
                          رفع الحظر
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState title={status === "active" ? "لا يوجد مرضى محظورون حاليًا" : "لا يوجد سجل حظر"} />
      )}

      <BlockPatientDialog target={target} mode="unblock" onClose={() => setTarget(null)} />
    </div>
  );
}
