import { useQuery } from "@tanstack/react-query";
import { Users, Stethoscope, Building2, CalendarDays, CalendarClock, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { api } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/ui/States";

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get("/admin/stats")).data.data,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">لوحة تحكم الإدارة</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="المرضى" value={stats?.patients ?? 0} icon={Users} />
        <StatCard label="الأطباء" value={stats?.doctors ?? 0} icon={Stethoscope} />
        <StatCard label="العيادات" value={stats?.clinics ?? 0} icon={Building2} />
        <StatCard label="إجمالي المواعيد" value={stats?.appointments ?? 0} icon={CalendarDays} />
        <StatCard label="مواعيد اليوم" value={stats?.todayAppointments ?? 0} icon={CalendarClock} />
        <StatCard label="مواعيد مكتملة" value={stats?.completed ?? 0} icon={CheckCircle2} tone="green" />
        <StatCard label="مواعيد ملغاة" value={stats?.cancelled ?? 0} icon={XCircle} tone="red" />
        <StatCard label="أطباء بانتظار التحقق" value={stats?.pendingVerification ?? 0} icon={ShieldAlert} tone="amber" />
      </div>
    </div>
  );
}
