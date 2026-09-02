import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarCheck, Users, CheckCircle2, XCircle, Star } from "lucide-react";
import { api } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/ui/States";
import { VerificationBadge } from "../../components/ui/Badge";

export default function DoctorDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["doctor-dashboard"],
    queryFn: async () => (await api.get("/doctor/dashboard")).data.data,
    // تحديث تلقائي للأرقام دون إعادة تحميل الصفحة (يتوقف عندما يكون التبويب في الخلفية).
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-slate-900">لوحة تحكم الطبيب</h1>
        {stats && <VerificationBadge status={stats.verificationStatus} />}
      </div>

      {stats?.verificationStatus === "PENDING" && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ملفك المهني قيد المراجعة من طرف الإدارة. لن تظهر في نتائج بحث المرضى حتى تتم الموافقة.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="مواعيد اليوم" value={stats?.todayAppointments ?? 0} icon={CalendarClock} />
        <StatCard label="المواعيد القادمة" value={stats?.upcomingAppointments ?? 0} icon={CalendarCheck} />
        <StatCard label="إجمالي المرضى" value={stats?.totalPatients ?? 0} icon={Users} />
        <StatCard label="المواعيد المكتملة" value={stats?.completedAppointments ?? 0} icon={CheckCircle2} tone="green" />
        <StatCard label="المواعيد الملغاة" value={stats?.cancelledAppointments ?? 0} icon={XCircle} tone="red" />
        <StatCard label="متوسط التقييم" value={`${(stats?.avgRating ?? 0).toFixed(1)} (${stats?.reviewsCount ?? 0})`} icon={Star} tone="amber" />
      </div>
    </div>
  );
}
