import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLocale, catalogName } from "../../i18n/locale.ts";
import { useAdminListParams } from "../../hooks/useAdminListParams";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Stethoscope, Building2, CalendarDays, CalendarClock, CheckCircle2, XCircle, ShieldAlert, MessageSquare, UserPlus, Search, Activity, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api, apiErrorMessage } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner, ErrorState } from "../../components/ui/States";
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
  useLanguage();
  const { q, setQ, search: dq } = useAdminListParams();
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["admin-search", dq],
    enabled: dq.length >= 2,
    queryFn: async ({ signal }) => (await api.get("/admin/search", { signal, params: { q: dq } })).data.data,
  });
  const empty = data && !data.doctors.length && !data.patients.length && !data.appointments.length && !data.messages.length;
  const name = (x: { firstName: string; lastName: string }) => `${x.firstName} ${x.lastName}`;
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input aria-label={t("البحث العام في الإدارة")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("بحث عن طبيب أو مريض أو موعد أو رسالة...")} className="input ps-9" />
      {dq.length >= 2 && q.trim() === dq && (
        <div className="absolute z-20 mt-2 max-h-96 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
          {isFetching && <p className="p-3 text-sm text-slate-500">{t("جارٍ البحث...")}</p>}
          {isError && <p className="p-3 text-sm text-red-600">{t("تعذّر البحث. ")}<button className="btn-ghost" onClick={() => void refetch()}>{t("إعادة المحاولة")}</button></p>}
          {empty && <p className="p-3 text-sm text-slate-500">{t("لا نتائج مطابقة.")}</p>}
          {data?.doctors.map((d: any) => (
            <Link key={d.id} to={`/admin/doctors?id=${encodeURIComponent(d.id)}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-xs text-slate-400">{t("طبيب · ")}</span>{t("د. ")}{name(d)} {catalogName(d.specialty) && <span className="text-slate-500">— {catalogName(d.specialty)}</span>}
            </Link>
          ))}
          {data?.patients.map((p: any) => (
            <Link key={p.id} to={`/admin/users?role=PATIENT&id=${encodeURIComponent(p.userId)}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-xs text-slate-400">{t("مريض · ")}</span>{name(p)} {p.phone && <span className="text-slate-500" dir="ltr">{p.phone}</span>}
            </Link>
          ))}
          {data?.appointments.map((a: any) => (
            <Link key={a.id} to={`/admin/appointments?id=${encodeURIComponent(a.id)}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-xs text-slate-400">{t("موعد · ")}</span>
              {a.familyMember ? name(a.familyMember) : a.patient ? name(a.patient) : `${a.guestFirstName ?? ""} ${a.guestLastName ?? ""}`}{t(" — د. ")}{name(a.doctor)} — {new Date(a.date).toLocaleDateString(getLocale(), { timeZone: "UTC" })} {a.startTime}
            </Link>
          ))}
          {data?.messages.map((m: any) => (
            <Link key={m.id} to={`/admin/messages?doctor=${m.doctorId}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
              <span className="text-xs text-slate-400">{t("رسالة · ")}</span>{t("د. ")}{m.doctorName}: <span className="text-slate-500">{m.preview}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickActions({ pending, unread }: { pending: number; unread: number }) {
  useLanguage();
  const actions = [
    { to: "/admin/doctors?status=PENDING", label: t("مراجعة طلبات التحقق"), icon: ShieldAlert, badge: pending },
    { to: "/admin/appointments?filter=today", label: t("مواعيد اليوم"), icon: CalendarClock },
    { to: "/admin/users", label: t("المستخدمون"), icon: Users },
    { to: "/admin/messages", label: t("الرسائل"), icon: MessageSquare, badge: unread },
    { to: "/admin/doctors", label: t("إدارة الأطباء"), icon: UserPlus },
  ];
  return (
    <div className="card p-4 sm:p-5">
      <h2 className="mb-3 font-bold text-slate-800">{t("يحتاج متابعة ووصول سريع")}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {actions.map((a) => (
          <Link key={a.to} to={a.to} className="relative flex flex-col items-center gap-2 rounded-xl border border-slate-200 p-3 text-center text-xs font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-primary-300 hover:bg-primary-50 hover:shadow-sm sm:text-sm">
            <a.icon className="h-5 w-5 text-primary-600" />
            {t(a.label)}
            {a.badge ? <span className="absolute end-2 top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{a.badge}</span> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  useLanguage();
  const { data: stats, isLoading, isError, error, refetch } = useQuery({
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

  if (isLoading || isError) return <div className="space-y-5"><h1 className="text-2xl font-extrabold text-slate-900">{t("لوحة تحكم الإدارة")}</h1>{isLoading ? <Spinner /> : <ErrorState message={apiErrorMessage(error)} onRetry={() => void refetch()} />}</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-900">{t("لوحة تحكم الإدارة")}</h1>

      <GlobalSearch />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("المرضى")} value={stats?.patients ?? 0} icon={Users} to="/admin/users?role=PATIENT" />
        <StatCard label={t("الأطباء")} value={stats?.doctors ?? 0} icon={Stethoscope} to="/admin/doctors" />
        <StatCard label={t("العيادات")} value={stats?.clinics ?? 0} icon={Building2} to="/admin/clinics" />
        <StatCard label={t("إجمالي المواعيد")} value={stats?.appointments ?? 0} icon={CalendarDays} to="/admin/appointments" />
        <StatCard label={t("مواعيد اليوم")} value={stats?.todayAppointments ?? 0} icon={CalendarClock} to="/admin/appointments?filter=today" />
        <StatCard label={t("مواعيد مكتملة")} value={stats?.completed ?? 0} icon={CheckCircle2} tone="green" to="/admin/appointments?filter=completed" />
        <StatCard label={t("مواعيد ملغاة")} value={stats?.cancelled ?? 0} icon={XCircle} tone="red" to="/admin/appointments?filter=cancelled" />
        <StatCard label={t("أطباء بانتظار التحقق")} value={stats?.pendingVerification ?? 0} icon={ShieldAlert} tone="amber" to="/admin/doctors?status=PENDING" />
      </div>

      <QuickActions pending={stats?.pendingVerification ?? 0} unread={unread.data?.unread ?? 0} />

      <p className="text-sm text-slate-600">{t("مواعيد اليوم تشمل جميع الحالات، بما فيها الملغاة.")}</p>
      <AppointmentsChart />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card block space-y-2 p-4 transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md sm:p-5">
          <h2 className="flex items-center gap-2 font-bold text-slate-800">
            <MessageSquare className="h-5 w-5 text-primary-600" />
            <Link to={unread.data?.latest ? `/admin/messages?doctor=${unread.data.latest.doctorId}` : "/admin/messages"} className="hover:underline">{t("الرسائل")}</Link>
          </h2>
          {unread.isLoading ? (
            <p className="text-sm text-slate-500">{t("جارٍ التحميل...")}</p>
          ) : unread.isError ? (
            <ErrorState message={apiErrorMessage(unread.error)} onRetry={() => void unread.refetch()} />
          ) : (
            <>
              <p className="text-2xl font-extrabold text-slate-900">
                {unread.data?.unread ?? 0} <span className="text-sm font-medium text-slate-500">{t("غير مقروءة")}</span>
              </p>
              {unread.data?.latest ? (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <p className="text-xs text-slate-500">{t("آخر رسالة")}</p>
                  <p className="font-semibold text-slate-800">{t("د. ")}{unread.data.latest.doctorName}</p>
                  <p className="truncate text-slate-600">"{unread.data.latest.preview}"</p>
                  <p className="mt-1 text-xs text-slate-400">{timeAgo(unread.data.latest.at)}</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">{t("لا توجد رسائل بعد")}</p>
              )}
            </>
          )}
        </div>

        <div className="card space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold text-slate-800">
              <Activity className="h-5 w-5 text-primary-600" />{t("حالة النظام ")}</h2>
            <button onClick={() => status.refetch()} className="btn-ghost !p-1.5" aria-label={t("إعادة الفحص")} title={t("إعادة فحص حالة النظام")} disabled={status.isFetching}>
              <RefreshCw className={clsx("h-4 w-4", status.isFetching && "animate-spin")} />
            </button>
          </div>
          {status.data?.checkedAt && <p className="text-xs text-slate-600">{t("آخر فحص: ")}{new Date(status.data.checkedAt).toLocaleString(getLocale())}{t(". لا يرسل الفحص SMS أو إشعارات.")}</p>}
          {status.isLoading ? (
            <p className="text-sm text-slate-500">{t("جارٍ الفحص...")}</p>
          ) : status.isError ? (
            <ErrorState message={apiErrorMessage(status.error)} onRetry={() => void status.refetch()} />
          ) : (
            <ul className="space-y-2">
              {status.data?.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <span className={clsx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", STATE_STYLE[c.state].dot)} />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">
                      {t(c.label)} <span className="text-xs font-medium text-slate-500">· {STATE_STYLE[c.state].text}</span>
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
        <h2 className="font-bold text-slate-800">{t("آخر النشاطات")}</h2>
        {activity.isLoading ? (
          <p className="text-sm text-slate-500">{t("جارٍ التحميل...")}</p>
        ) : activity.isError ? (
          <ErrorState message={apiErrorMessage(activity.error)} onRetry={() => void activity.refetch()} />
        ) : activity.data && activity.data.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {activity.data.map((a) => (
              <li key={a.id}>
                <Link to={a.link} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm transition hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{a.title}</p>
                    {a.detail && <p className="truncate text-xs text-slate-500">{a.detail}</p>}
                  </div>
                  <span title={new Date(a.at).toLocaleString(getLocale())} className="shrink-0 text-xs text-slate-500">{t("وقت النشاط: ")}{timeAgo(a.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{t("لا توجد نشاطات بعد.")}</p>
        )}
      </div>

      <Link to="/admin/maintenance" className="btn-outline">{t("صيانة البيانات التجريبية")}</Link>
    </div>
  );
}
