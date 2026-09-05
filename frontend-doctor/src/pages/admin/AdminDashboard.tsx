import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Stethoscope, Building2, CalendarDays, CalendarClock, CheckCircle2, XCircle, ShieldAlert, Trash2 } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get("/admin/stats")).data.data,
  });

  const { showToast } = useToast();
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<Record<string, number> | null>(null);

  // يحذف فقط حسابات seed.ts التجريبية (بريد ينتهي بـ dr.*/patient.*@medbook.dz) — لا يمسّ
  // أي مستخدم حقيقي إطلاقًا. انظر purgeDemoData في admin.service.ts للنطاق الدقيق.
  async function purgeDemoData() {
    if (!confirm("سيتم حذف كل حسابات المستخدمين والأطباء التجريبية (seed) نهائيًا. هذا الإجراء لا يمكن التراجع عنه. متابعة؟")) return;
    setPurging(true);
    try {
      const res = await api.post("/admin/maintenance/purge-demo-data");
      setPurgeResult(res.data.data);
      showToast("تم حذف البيانات التجريبية.", "success");
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setPurging(false);
    }
  }

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

      <div className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-bold text-slate-800">
          <Trash2 className="h-5 w-5 text-red-500" />
          صيانة — تنظيف البيانات التجريبية
        </h2>
        <p className="text-sm text-slate-500">
          يحذف نهائيًا حسابات وبيانات seed.ts التجريبية فقط (أطباء ومرضى بعناوين بريد تنتهي بـ @medbook.dz). لا يمسّ هذا أي مستخدم حقيقي.
        </p>
        <Button variant="danger" loading={purging} onClick={purgeDemoData}>
          حذف البيانات التجريبية
        </Button>
        {purgeResult && (
          <p className="text-sm text-slate-600">
            تم حذف: {purgeResult.users} مستخدم، {purgeResult.doctors} طبيب، {purgeResult.patients} مريض، {purgeResult.appointments} موعد،{" "}
            {purgeResult.reviews} تقييم، {purgeResult.clinics} عيادة.
          </p>
        )}
      </div>
    </div>
  );
}
