import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { useMyAppointments } from "../../hooks/useAppointments";
import { Spinner } from "../../components/ui/States";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { Link } from "react-router-dom";

export default function PatientDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["patient-dashboard"],
    queryFn: async () => (await api.get("/patient/dashboard")).data.data,
  });
  const { data: appointments } = useMyAppointments();

  const upcoming = appointments?.filter((a) => ["PENDING", "CONFIRMED"].includes(a.status)).slice(0, 5);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">مرحبًا بك 👋</h1>

      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="المواعيد القادمة" value={stats?.upcomingAppointments ?? 0} icon={CalendarClock} />
          <StatCard label="المواعيد السابقة" value={stats?.pastAppointments ?? 0} icon={CheckCircle2} tone="green" />
          <StatCard label="المواعيد الملغاة" value={stats?.cancelledAppointments ?? 0} icon={XCircle} tone="red" />
        </div>
      )}

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">مواعيدي القادمة</h2>
          <Link to="/patient/appointments" className="text-sm font-semibold text-primary-700 hover:underline">
            عرض الكل
          </Link>
        </div>
        {upcoming && upcoming.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {upcoming.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold text-slate-800">
                    د. {a.doctor?.firstName} {a.doctor?.lastName}
                  </p>
                  <p className="text-sm text-slate-500">
                    {new Date(a.date).toLocaleDateString("ar-DZ")} — {a.startTime}
                  </p>
                </div>
                <AppointmentStatusBadge status={a.status} />
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">لا توجد مواعيد قادمة. ابحث عن طبيب وابدأ بالحجز.</p>
        )}
      </div>
    </div>
  );
}
