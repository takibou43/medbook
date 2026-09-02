import { useCallback, useState } from "react";
import clsx from "clsx";
import { Bell, BellRing, RefreshCw } from "lucide-react";
import { useMyAppointments, useUpdateAppointmentStatus } from "../../hooks/useAppointments";
import { useNewAppointmentAlert, requestNotificationPermission } from "../../hooks/useNewAppointmentAlert";
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
  const { data: appointments, isLoading, isFetching, dataUpdatedAt } = useMyAppointments(filter);
  const updateStatus = useUpdateAppointmentStatus();
  const { showToast } = useToast();
  const [notifOn, setNotifOn] = useState(typeof Notification !== "undefined" && Notification.permission === "granted");

  // تنبيه فوري عند وصول حجز جديد أثناء فتح الصفحة (صوت + إشعار + رسالة).
  const handleNew = useCallback(
    (count: number) => {
      showToast(count === 1 ? "وصلك حجز جديد!" : `وصلتك ${count} حجوزات جديدة!`, "success");
    },
    [showToast]
  );
  useNewAppointmentAlert(appointments, handleNew);

  async function enableNotifications() {
    const res = await requestNotificationPermission();
    if (res === "granted") {
      setNotifOn(true);
      showToast("تم تفعيل إشعارات الحجوزات الجديدة.", "success");
    } else if (res === "denied") {
      showToast("الإشعارات محظورة في إعدادات المتصفح.", "error");
    } else if (res === "unsupported") {
      showToast("متصفحك لا يدعم الإشعارات.", "error");
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-slate-900">إدارة المواعيد</h1>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <RefreshCw className={clsx("h-3.5 w-3.5", isFetching && "animate-spin")} />
            {isFetching
              ? "جارٍ التحديث..."
              : dataUpdatedAt
                ? `آخر تحديث ${new Date(dataUpdatedAt).toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" })}`
                : "تحديث تلقائي"}
          </span>
          <button
            type="button"
            onClick={enableNotifications}
            disabled={notifOn}
            className={clsx(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
              notifOn ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {notifOn ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            {notifOn ? "الإشعارات مفعّلة" : "تفعيل إشعارات الحجوزات"}
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500">
        تتحدّث هذه الصفحة تلقائيًا كل 15 ثانية — سيظهر أي حجز جديد فورًا دون إعادة تحميل الصفحة.
      </p>

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
