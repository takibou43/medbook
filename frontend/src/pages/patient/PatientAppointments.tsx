import { useState } from "react";
import { useMyAppointments, useCancelAppointment } from "../../hooks/useAppointments";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { RatingStars } from "../../components/ui/RatingStars";
import { Textarea } from "../../components/ui/Input";
import { useToast } from "../../components/ui/Toast";
import { api, apiErrorMessage } from "../../lib/api";
import { AppointmentStatus } from "../../types";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";

const FILTERS: { label: string; value?: AppointmentStatus }[] = [
  { label: "الكل", value: undefined },
  { label: "قادمة", value: "PENDING" },
  { label: "مؤكدة", value: "CONFIRMED" },
  { label: "مكتملة", value: "COMPLETED" },
  { label: "ملغاة", value: "CANCELLED" },
];

export default function PatientAppointments() {
  const [filter, setFilter] = useState<AppointmentStatus | undefined>(undefined);
  const { data: appointments, isLoading } = useMyAppointments(filter);
  const cancelMutation = useCancelAppointment();
  const { showToast } = useToast();
  const qc = useQueryClient();

  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCancel(id: string) {
    if (!confirm("هل أنت متأكد من إلغاء هذا الموعد؟")) return;
    try {
      await cancelMutation.mutateAsync(id);
      showToast("تم إلغاء الموعد.", "success");
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  async function submitReview() {
    if (!reviewTarget) return;
    setSubmitting(true);
    try {
      await api.post("/reviews", { appointmentId: reviewTarget, rating, comment: comment || undefined });
      showToast("شكرًا لتقييمك!", "success");
      setReviewTarget(null);
      setComment("");
      setRating(5);
      qc.invalidateQueries({ queryKey: ["appointments"] });
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إرسال التقييم."), "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">مواعيدي</h1>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={clsx(
              "rounded-full px-4 py-1.5 text-sm font-semibold transition",
              filter === f.value ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner />
      ) : appointments && appointments.length > 0 ? (
        <div className="space-y-3">
          {appointments.map((a) => (
            <div key={a.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-bold text-slate-800">
                  د. {a.doctor?.firstName} {a.doctor?.lastName}
                </p>
                <p className="text-sm text-primary-700">{a.doctor?.specialty?.nameAr}</p>
                <p className="text-sm text-slate-500">
                  {new Date(a.date).toLocaleDateString("ar-DZ")} — {a.startTime}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <AppointmentStatusBadge status={a.status} />
                {(a.status === "PENDING" || a.status === "CONFIRMED") && (
                  <Button variant="danger" onClick={() => handleCancel(a.id)}>
                    إلغاء
                  </Button>
                )}
                {a.status === "COMPLETED" && !a.review && (
                  <Button variant="outline" onClick={() => setReviewTarget(a.id)}>
                    قيّم الطبيب
                  </Button>
                )}
                {a.review && <span className="text-xs text-slate-400">تم التقييم</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="لا توجد مواعيد" description="لم تقم بحجز أي موعد بعد." />
      )}

      <Modal
        open={!!reviewTarget}
        onClose={() => setReviewTarget(null)}
        title="تقييم الطبيب"
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>
              إلغاء
            </Button>
            <Button onClick={submitReview} loading={submitting}>
              إرسال التقييم
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="label">التقييم</p>
            <RatingStars value={rating} interactive size={28} onChange={setRating} />
          </div>
          <Textarea label="تعليق (اختياري)" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
