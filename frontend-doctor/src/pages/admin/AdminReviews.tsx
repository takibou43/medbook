import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { RatingStars } from "../../components/ui/RatingStars";
import { useToast } from "../../components/ui/Toast";

export default function AdminReviews() {
  const { data, isLoading } = useQuery({
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

      {isLoading ? (
        <Spinner />
      ) : data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((r: any) => (
            <div key={r.id} className="card flex items-start justify-between gap-4 p-4">
              <div>
                <p className="font-semibold text-slate-800">
                  {r.patient?.firstName} {r.patient?.lastName} ← د. {r.doctor?.firstName} {r.doctor?.lastName}
                </p>
                <RatingStars value={r.rating} size={14} />
                {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
              </div>
              <button onClick={() => remove(r.id)} className="rounded-lg p-2 text-red-500 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="لا توجد تقييمات" />
      )}
    </div>
  );
}
