import { AdminResults, AdminActions } from "../../components/admin/AdminUI";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { RatingStars } from "../../components/ui/RatingStars";
import { useToast } from "../../components/ui/Toast";

export default function AdminReviews() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-reviews"],
    queryFn: async () => (await api.get("/admin/reviews")).data.data,
  });
  const { showToast } = useToast();
  const qc = useQueryClient();

  async function remove(id: string) {
    if (!confirm("حذف هذا التقييم؟")) return;
    try {
      await api.delete(`/admin/reviews/${id}`);
      showToast("تم حذف التقييم.", "success");
      qc.invalidateQueries({ queryKey: ["admin-reviews"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">إدارة التقييمات</h1>

      <AdminResults total={data?.length} />
      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} onRetry={() => void refetch()} />
      ) : data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((r: any) => (
            <div key={r.id} className="card flex flex-wrap items-start justify-between gap-4 p-4">
              <div>
                <p className="font-semibold text-slate-800">
                  {r.patient?.firstName} {r.patient?.lastName} ← د. {r.doctor?.firstName} {r.doctor?.lastName}
                </p>
                <RatingStars value={r.rating} size={14} />
                {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
              </div>
              <AdminActions label={"تقييم " + (r.patient?.firstName ?? "") + " " + (r.patient?.lastName ?? "")}>
              <button aria-label={`حذف تقييم ${r.patient?.firstName ?? ""} ${r.patient?.lastName ?? ""} للطبيب ${r.doctor?.firstName ?? ""} ${r.doctor?.lastName ?? ""}`} title="حذف التقييم" onClick={() => remove(r.id)} className="btn-ghost justify-start text-red-600">
                <Trash2 className="h-4 w-4" />
                حذف التقييم
              </button>
              </AdminActions>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="لا توجد تقييمات" />
      )}
    </div>
  );
}
