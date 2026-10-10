import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLocale } from "../../i18n/locale.ts";
import { loadAdminDoctorOptions } from '../../components/admin/doctorOptions';
import { useAdminListParams } from "../../hooks/useAdminListParams";
import { AdminResults } from "../../components/admin/AdminUI";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { Input, Select } from "../../components/ui/Input";
import { Pagination } from "../../components/ui/Pagination";

const FILTERS = [{ key: "all", label: "الكل" }, { key: "today", label: "مواعيد اليوم" }, { key: "completed", label: "المكتملة" }, { key: "cancelled", label: "الملغاة" }] as const;
const STATUS: Record<string, { text: string; cls: string }> = {
  RESCHEDULE_REQUIRED: {text:"يحتاج إعادة ترتيب",cls:"bg-amber-100 text-amber-700"},
  PENDING: { text: "قيد الانتظار", cls: "bg-slate-100 text-slate-700" },
  CONFIRMED: { text: "مؤكد", cls: "bg-blue-100 text-blue-700" },
  IN_PROGRESS: { text: "جارٍ", cls: "bg-primary-100 text-primary-700" },
  LATE: { text: "متأخر", cls: "bg-amber-100 text-amber-700" },
  COMPLETED: { text: "مكتمل", cls: "bg-green-100 text-green-700" },
  CANCELLED: { text: "ملغى", cls: "bg-red-100 text-red-700" },
  NO_SHOW: { text: "لم يحضر", cls: "bg-orange-100 text-orange-700" },
};
interface Person { firstName: string; lastName: string; clinic?:{id:string;nameAr:string}|null }
interface Row { id: string; date: string; startTime: string; status: string; doctor: Person; patient?: Person; familyMember?: Person; familyMemberId?: string; guestFirstName?: string; guestLastName?: string }
const personName = (p: Person) => [p.firstName, p.lastName].join(" ");
const beneficiary = (a: Row) => a.familyMember ? personName(a.familyMember) : a.familyMemberId ? t("فرد عائلة (الاسم غير متاح)") : a.patient ? personName(a.patient) : [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ") || "—";
const dateLabel = (date: string) => new Date(date).toLocaleDateString(getLocale(), { timeZone: "UTC" });
const badge = (a: Row) => { const state = STATUS[a.status] ?? { text: a.status, cls: "bg-slate-100 text-slate-700" }; return <span className={clsx("badge", state.cls)}>{state.text}</span>; };

export default function AdminAppointments() {
  useLanguage();
  const { params, q, setQ, search, page, setPage, update, clear } = useAdminListParams();
  const id = params.get("id");
  const filter = FILTERS.find((f) => f.key === params.get("filter"))?.key ?? "all";
  const from=params.get("from")??"",to=params.get("to")??"",doctorId=params.get("doctorId")??"",status=params.get("status")??"";
  const doctors=useQuery({queryKey:["admin-doctor-options"],queryFn:({signal})=>loadAdminDoctorOptions(signal)});
  const filtered = !!(q || id || filter !== "all" || from || to || doctorId || status);
  const query = useQuery({
    queryKey: ["admin-appointments", filter, search, page, id, from,to,doctorId,status],
    queryFn: async ({ signal }) => (await api.get("/admin/appointments", { signal, params: { id: id || undefined, filter, q: search || undefined, from:from||undefined,to:to||undefined,doctorId:doctorId||undefined,status:status||undefined,page } })).data.data as { items: Row[]; total: number; page: number; totalPages: number },
  });
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-extrabold text-slate-900">{t("المواعيد")}</h1><p className="mt-1 text-sm text-slate-600">{t("تابع الطبيب والمستفيد وحالة كل موعد.")}</p></header>
    {id && <p className="text-sm text-primary-700" role="status">{t("عرض الموعد المحدد من الرابط")}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" aria-label={t("تصفية المواعيد")}>
        {FILTERS.map((f) => <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => update("filter", f.key === "all" ? "" : f.key)} className={clsx("min-h-11 rounded-lg px-3 py-1.5 text-sm font-semibold", filter === f.key ? "bg-white text-primary-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{t(f.label)}</button>)}
      </div>
      <Input label={t("بحث باسم الطبيب أو المستفيد")} placeholder={t("الاسم...")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Select label={t("طبيب الموعد")} value={doctorId} onChange={e=>update('doctorId',e.target.value)}><option value="">{t("كل الأطباء")}</option>{(doctors.data?.items??[]).map((d:any)=><option key={d.id} value={d.id}>{t("د. ")}{d.firstName} {d.lastName}</option>)}</Select><Select label={t("حالة الموعد")} value={status} onChange={e=>update('status',e.target.value)}><option value="">{t("كل الحالات")}</option>{Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.text}</option>)}</Select><Input label={t("من تاريخ")} type="date" value={from} onChange={e=>update('from',e.target.value)}/><Input label={t("إلى تاريخ")} min={from||undefined} type="date" value={to} onChange={e=>update('to',e.target.value)}/></div>
    <AdminResults total={query.data?.total} filtered={filtered} onClear={clear} />
    {query.isLoading ? <Spinner /> : query.isError ? <ErrorState message={apiErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : query.data?.items.length ? <>
      <div className="space-y-3 md:hidden">
        {query.data.items.map((a) => <article key={a.id} aria-label={t("موعد ") + beneficiary(a)} className={clsx("card space-y-3 p-4", a.id === id && "ring-2 ring-primary-400")}>
          <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 break-words font-bold text-slate-900"><bdi>{beneficiary(a)}</bdi></h2>{badge(a)}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-600">{t("الطبيب")}</dt><dd className="min-w-0 break-words text-slate-800"><bdi>{t("د. ")}{personName(a.doctor)}</bdi></dd>
            <dt className="text-slate-600">{t("التاريخ")}</dt><dd className="text-slate-800">{dateLabel(a.date)}</dd>
            <dt className="text-slate-600">{t("الوقت")}</dt><dd className="text-slate-800"><bdi dir="ltr">{a.startTime}</bdi></dd>
            <dt className="text-slate-600">{t("العيادة")}</dt><dd>{a.doctor.clinic?.nameAr??t("طبيب مستقل")}</dd>
          </dl>
        </article>)}
      </div>
      <div className="card hidden overflow-x-auto p-0 md:block"><table className="w-full text-start text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{[t("التاريخ"), t("الوقت"), t("الطبيب"), t("المستفيد"), t("الحالة")].map((label) => <th key={label} className="px-4 py-3 font-semibold">{t(label ?? "")}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
        {query.data.items.map((a) => <tr key={a.id} className={clsx("hover:bg-slate-50", id === a.id && "bg-primary-50")}><td className="whitespace-nowrap px-4 py-3">{dateLabel(a.date)}</td><td className="px-4 py-3"><bdi dir="ltr">{a.startTime}</bdi></td><td className="px-4 py-3"><bdi>{t("د. ")}{personName(a.doctor)}</bdi></td><td className="px-4 py-3"><bdi>{beneficiary(a)}</bdi></td><td className="px-4 py-3">{badge(a)}<details className="mt-2"><summary className="cursor-pointer text-primary-700">{t("تفاصيل الموعد")}</summary><p className="mt-2">{t("المستفيد: ")}{beneficiary(a)}{t(" · العيادة: ")}{a.doctor.clinic?.nameAr??t("طبيب مستقل")}</p></details></td></tr>)}
      </tbody></table></div>
      <Pagination page={query.data.page} totalPages={query.data.totalPages} onChange={setPage} />
    </> : <EmptyState title={filtered ? t("لا نتائج مطابقة") : t("لا توجد مواعيد")} description={filtered ? t("جرّب تغيير البحث أو مسح الفلاتر.") : t("ستظهر المواعيد هنا عند تسجيلها.")} />}
  </div>;
}
