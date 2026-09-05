import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { VerificationBadge, SubscriptionBadge } from "../../components/ui/Badge";
import { useToast } from "../../components/ui/Toast";
import { Pagination } from "../../components/ui/Pagination";
import { VerificationStatus, SubscriptionStatus } from "../../types";

export default function AdminDoctors() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<VerificationStatus | "">("");
  const [page, setPage] = useState(1);
  const { showToast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-doctors", q, status, page],
    queryFn: async () =>
      (await api.get("/admin/doctors", { params: { q: q || undefined, verificationStatus: status || undefined, page } })).data.data,
  });

  async function setVerification(id: string, s: VerificationStatus) {
    try {
      await api.patch(`/admin/doctors/${id}/verify`, { status: s });
      showToast("تم تحديث حالة التحقق.", "success");
      qc.invalidateQueries({ queryKey: ["admin-doctors"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  // لا توجد بوابة دفع فعلية بعد (بانتظار حساب تاجر إلكتروني BaridiMob) — الإدارة تُفعّل
  // اشتراك الطبيب يدويًا من هنا بعد التحقق من الدفع خارج المنصة (تحويل بنكي، إلخ).
  async function setSubscription(id: string, s: SubscriptionStatus) {
    try {
      await api.patch(`/admin/doctors/${id}`, { subscriptionStatus: s });
      showToast("تم تحديث حالة الاشتراك.", "success");
      qc.invalidateQueries({ queryKey: ["admin-doctors"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">إدارة الأطباء</h1>

      <div className="flex flex-wrap gap-3">
        <Input placeholder="بحث بالاسم..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value as VerificationStatus | "")}>
          <option value="">كل الحالات</option>
          <option value="PENDING">قيد المراجعة</option>
          <option value="VERIFIED">موثّق</option>
          <option value="REJECTED">مرفوض</option>
        </select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-3">
            {data.items.map((d: any) => (
              <div key={d.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-slate-800">
                    د. {d.firstName} {d.lastName} — {d.specialty?.nameAr}
                  </p>
                  <p className="text-sm text-slate-500">
                    {d.user?.email} — {d.city?.nameAr}، {d.wilaya?.nameAr}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <VerificationBadge status={d.verificationStatus} />
                  <SubscriptionBadge status={d.subscriptionStatus ?? "UNPAID"} />
                  {d.verificationStatus !== "VERIFIED" && (
                    <Button onClick={() => setVerification(d.id, "VERIFIED")}>توثيق</Button>
                  )}
                  {d.verificationStatus !== "REJECTED" && (
                    <Button variant="danger" onClick={() => setVerification(d.id, "REJECTED")}>
                      رفض
                    </Button>
                  )}
                  {d.subscriptionStatus !== "ACTIVE" ? (
                    <Button variant="outline" onClick={() => setSubscription(d.id, "ACTIVE")}>
                      تفعيل الاشتراك
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setSubscription(d.id, "UNPAID")}>
                      إيقاف الاشتراك
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState title="لا يوجد أطباء" />
      )}
    </div>
  );
}
