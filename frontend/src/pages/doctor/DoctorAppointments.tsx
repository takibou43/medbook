import { useState } from "react";
import clsx from "clsx";
import { useMyAppointments, useUpdateAppointmentStatus } from "../../hooks/useAppointments";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { AppointmentStatus } from "../../types";

const FILTERS: { label: string; value?: AppointmentStatus }[] = [
  { label: "الكل", value: undefined },
  { label: "بانتظار التأكيد", value: "PENDING" },
  { label: "مؤكدة", value: "CONFIRMED" },
  { label: "مكتملة", value: "COMPLETED" },
  { label: "ملغاة", value: "CANCELLED" },
  { label: "لم يحضر", value: "NO_SHOW" },
];

export default function DoctorAppointments() {
  const [filter, setFilter] = useState<AppointmentStatus | undefined>(undefined);
  const { data: appointments, isLoading } = useMyAppointments(filter);
  const updateStatus = useUpdateAppointmentStatus();
  const { showToast } = useToast();

  async function changeStatus(id: string, status: AppointmentStatus) {
    try {
      await updateStatus.mutateAsync({ id, status });
      showToast("تم تحديث حالة الموعد.", "success");
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">إدارة المواعيد</h1>

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
                  {a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : `${a.guestFirstName ?? ""} ${a.guestLastName ?? ""}`}
                  {!a.patient && <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">بدون حساب</span>}
                </p>
                <p className="text-sm text-slate-500">{a.patient?.user?.phone ?? a.patient?.user?.email ?? a.guestPhone ?? "—"}</p>
                <p className="text-sm text-slate-500">
                  {new Date(a.date).toLocaleDateString("ar-DZ")} — {a.startTime}
                </p>
                {a.notes && <p className="mt-1 text-xs text-slate-400">ملاحظات: {a.notes}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AppointmentStatusBadge status={a.status} />
                {a.status === "PENDING" && (
                  <>
                    <Button onClick={() => changeStatus(a.id, "CONFIRMED")}>قبول</Button>
                    <Button variant="danger" onClick={() => changeStatus(a.id, "CANCELLED")}>
                      رفض
                    </Button>
                  </>
                )}
                {a.status === "CONFIRMED" && (
                  <>
                    <Button onClick={() => changeStatus(a.id, "COMPLETED")}>إنهاء</Button>
                    <Button variant="outline" onClick={() => changeStatus(a.id, "NO_SHOW")}>
                      لم يحضر
                    </Button>
                    <Button variant="danger" onClick={() => changeStatus(a.id, "CANCELLED")}>
                      إلغاء
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="لا توجد مواعيد" />
      )}
    </div>
  );
}
