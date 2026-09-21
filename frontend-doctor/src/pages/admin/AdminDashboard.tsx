import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Stethoscope, Building2, CalendarDays, CalendarClock, CheckCircle2, XCircle, ShieldAlert, Trash2, MessageSquare, UserPlus, Search, Activity, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api, apiErrorMessage } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { AppointmentsChart } from "../../components/AppointmentsChart";
import { useAdminUnread, timeAgo } from "../../hooks/useMessaging";

interface ActivityItem { id: string; type: string; title: string; detail?: string; at: string; link: string }
interface SystemCheck { key: string; label: string; state: "ok" | "warn" | "error" | "off"; detail: string }

const STATE_STYLE: Record<SystemCheck["state"], { dot: string; text: string }> = {
  ok: { dot: "bg-green-500", text: "يعمل" },
  warn: { dot: "bg-amber-500", text: "تنبيه" },
  error: { dot: "bg-red-500", text: "لا يعمل" },
  off: { dot: "bg-slate-300", text: "غير مُفعّل" },
};

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching, isError } = useQuery({
    queryKey: ["admin-search", dq],
    enabled: dq.length >= 2,
    queryFn: async () => (await api.get("/admin/search", { params: { q: dq } })).data.data,
  });
  const empty = data && !data.doctors.length && !data.patients.length && !data.appointments.length && !data.messages.length;
  const name = (x: { firstName: string; lastName: string }) => `${x.firstName} ${x.lastName}`;
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث عن طبيب أو مريض أو موعد أو رسالة..." className="input pr-9" />
      {dq.length >= 2 && (
        <div className="absolute z-20 mt-2 max-h-96 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
          {isFetching && <p className="p-3 text-sm text-slate-500">جارٍ البحث...</p>}
          {isError && <p className="p-3 text-sm text-red-600">تعذّر البحث. حاول مرة أخرى.</p>}
          {empty && <p className="p-3 text-sm text-slate-500">لا نتائج مطابقة.</p>}
          {data?.doctors.map((d: any) => (
            <Link key={d.id} to={`/admin/doctors`} onClick={() => setQ("")} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-xs text-slate-400">طبيب · </span>د. {name(d)} {d.specialty?.nameAr && <span className="text-slate-500">— {d.specialty.nameAr}</span>}
            </Link>
          ))}
          {data?.patients.map((p: any) => (
            <Link key={p.id} to={`/admin/users?role=PATIENT`} onClick={() => setQ("")} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-xs text-slate-400">مريض · </span>{name(p)} {p.phone && <span className="text-slate-500" dir="ltr">{p.phone}</span>}
            </Link>
          ))}
          {data?.appointments.map((a: any) => (
            <Link key={a.id} to={`/admin/appointments`} onClick={() => setQ("")} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-xs text-slate-400">موعد · </span>
              {a.patient ? name(a.patient) : `${a.guestFirstName ?? ""} ${a.guestLastName ?? ""}`} — د. {name(a.doctor)} — {new Date(a.date).toLocaleDateString("ar-DZ", { timeZone: "UTC" })} {a.startTime}
            </Link>
          ))}
          {data?.messages.map((m: any) => (
            <Link key={m.id} to={`/admin/messages?doctor=${m.doctorId}`} onClick={() => setQ("")} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-xs text-slate-400">رسالة · </span>د. {m.doctorName}: <span className="text-slate-500">{m.preview}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickActions({ pending, unread }: { pending: number; unread: number }) {
  const actions = [
    { to: "/admin/doctors?status=PENDING", label: "مراجعة طلبات التحقق", icon: ShieldAlert, badge: pending },
    { to: "/admin/appointments?filter=today", label: "مواعيد اليوم", icon: CalendarClock },
    { to: "/admin/users", label: "المستخدمون", icon: Users },
    { to: "/admin/messages", label: "الرسائل", icon: MessageSquare, badge: unread },
    { to: "/admin/doctors", label: "إدارة الأطباء", icon: UserPlus },
  ];
  return (
    <div className="card p-4 sm:p-5">
      <h2 className="mb-3 font-bold text-slate-800">إجراءات سريعة</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {actions.map((a) => (
          <Link key={a.to} to={a.to} className="relative flex flex-col items-center gap-2 rounded-xl border border-slate-200 p-3 text-center text-xs font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-primary-300 hover:bg-primary-50 hover:shadow-sm sm:text-sm">
            <a.icon className="h-5 w-5 text-primary-600" />
            {a.label}
            {a.badge ? <span className="absolute left-2 top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{a.badge}</span> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get("/admin/stats")).data.data,
  });

  const unread = useAdminUnread();
  const activity = useQuery({
    queryKey: ["admin-activity"],
    queryFn: async () => (await api.get("/admin/activity")).data.data as ActivityItem[],
    refetchInterval: 60_000,
  });
  const status = useQuery({
    queryKey: ["admin-system-status"],
    queryFn: async () => (await api.get("/admin/system-status")).data.data as { checkedAt: string; checks: SystemCheck[] },
    refetchInterval: 60_000,
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

      <GlobalSearch />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="المرضى" value={stats?.patients ?? 0} icon={Users} to="/admin/users?role=PATIENT" />
        <StatCard label="الأطباء" value={stats?.doctors ?? 0} icon={Stethoscope} to="/admin/doctors" />
        <StatCard label="العيادات" value={stats?.clinics ?? 0} icon={Building2} />
        <StatCard label="إجمالي المواعيد" value={stats?.appointments ?? 0} icon={CalendarDays} to="/admin/appointments" />
        <StatCard label="مواعيد اليوم" value={stats?.todayAppointments ?? 0} icon={CalendarClock} to="/admin/appointments?filter=today" />
        <StatCard label="مواعيد مكتملة" value={stats?.completed ?? 0} icon={CheckCircle2} tone="green" to="/admin/appointments?filter=completed" />
        <StatCard label="مواعيد ملغاة" value={stats?.cancelled ?? 0} icon={XCircle} tone="red" to="/admin/appointments?filter=cancelled" />
        <StatCard label="أطباء بانتظار التحقق" value={stats?.pendingVerification ?? 0} icon={ShieldAlert} tone="amber" to="/admin/doctors?status=PENDING" />
      </div>

      <QuickActions pending={stats?.pendingVerification ?? 0} unread={unread.data?.unread ?? 0} />

      <AppointmentsChart />

      <div className="grid gap-4 lg:grid-cols-2">
        <Link to={unread.data?.latest ? `/admin/messages?doctor=${unread.data.latest.doctorId}` : "/admin/messages"} className="card block space-y-2 p-4 transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md sm:p-5">
          <h2 className="flex items-center gap-2 font-bold text-slate-800">
            <MessageSquare className="h-5 w-5 text-primary-600" />
            الرسائل
          </h2>
          {unread.isLoading ? (
            <p className="text-sm text-slate-500">جارٍ التحميل...</p>
          ) : unread.isError ? (
            <p className="text-sm text-red-600">تعذّر تحميل الرسائل.</p>
          ) : (
            <>
              <p className="text-2xl font-extrabold text-slate-900">
                {unread.data?.unread ?? 0} <span className="text-sm font-medium text-slate-500">غير مقروءة</span>
              </p>
              {unread.data?.latest ? (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <p className="text-xs text-slate-500">آخر رسالة</p>
                  <p className="font-semibold text-slate-800">د. {unread.data.latest.doctorName}</p>
                  <p className="truncate text-slate-600">"{unread.data.latest.preview}"</p>
                  <p className="mt-1 text-xs text-slate-400">{timeAgo(unread.data.latest.at)}</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">لا توجد رسائل بعد</p>
              )}
            </>
          )}
        </Link>

        <div className="card space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold text-slate-800">
              <Activity className="h-5 w-5 text-primary-600" />
              حالة النظام
            </h2>
            <button onClick={() => status.refetch()} className="btn-ghost !p-1.5" aria-label="إعادة الفحص" disabled={status.isFetching}>
              <RefreshCw className={clsx("h-4 w-4", status.isFetching && "animate-spin")} />
            </button>
          </div>
          {status.isLoading ? (
            <p className="text-sm text-slate-500">جارٍ الفحص...</p>
          ) : status.isError ? (
            <p className="text-sm text-red-600">تعذّر الاتصال بالخادم لفحص الحالة.</p>
          ) : (
            <ul className="space-y-2">
              {status.data?.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <span className={clsx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", STATE_STYLE[c.state].dot)} />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">
                      {c.label} <span className="text-xs font-medium text-slate-500">· {STATE_STYLE[c.state].text}</span>
                    </p>
                    <p className="text-xs text-slate-500">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card space-y-3 p-4 sm:p-5">
        <h2 className="font-bold text-slate-800">آخر النشاطات</h2>
        {activity.isLoading ? (
          <p className="text-sm text-slate-500">جارٍ التحميل...</p>
        ) : activity.isError ? (
          <p className="text-sm text-red-600">تعذّر تحميل النشاطات.</p>
        ) : activity.data && activity.data.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {activity.data.map((a) => (
              <li key={a.id}>
                <Link to={a.link} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm transition hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{a.title}</p>
                    {a.detail && <p className="truncate text-xs text-slate-500">{a.detail}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">لا توجد نشاطات بعد.</p>
        )}
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
