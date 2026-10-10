import { GuestFollowUpNotice } from "../../components/GuestFollowUpNotice";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarPlus, ChevronDown, Phone, Search } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { EmptyState, ErrorState, SkeletonRows } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { FollowUpModal, type FollowUpContext } from "../../components/FollowUpModal";
import { RELATIONSHIP_LABELS } from "../../lib/features";
import { formatDayAr, relativeDayAr } from "../../lib/doctorUi";

interface VisitRef {
  appointmentId: string;
  date: string;
  startTime: string;
  status: string;
}

interface PatientRow {
  key?: string;
  patientId: string | null;
  familyMemberId: string | null;
  isGuest: boolean;
  firstName: string | null;
  lastName: string | null;
  beneficiary?: { relationship?: string | null } | null;
  accountHolderName: string | null;
  email: string | null;
  phone: string | null;
  totalAppointments: number;
  lastCompletedVisit: VisitRef | null;
  nextAppointment: VisitRef | null;
  lastAppointmentId: string | null;
}

interface PatientPage {
  items: PatientRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type Sort = "recent" | "next" | "name";
const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "آخر زيارة مكتملة (الأحدث أولًا)" },
  { value: "next", label: "الموعد القادم (الأقرب أولًا)" },
  { value: "name", label: "الاسم (أبجديًا)" },
];
const PAGE_SIZE = 25;

const fullName = (p: PatientRow) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || t("مريض بدون اسم");

function LastVisit({ v }: { v: VisitRef | null }) {
  useLanguage();
  if (!v) return <span className="text-slate-500">{t("لا توجد زيارة مكتملة")}</span>;
  return <span>{formatDayAr(v.date, { weekday: false })}</span>;
}

function NextAppt({ v }: { v: VisitRef | null }) {
  useLanguage();
  if (!v) return <span className="text-slate-500">{t("لا يوجد موعد قادم")}</span>;
  return (
    <span>
      {relativeDayAr(v.date)} · <span className="ltr-nums">{v.startTime}</span>
    </span>
  );
}

function Tags({ p }: { p: PatientRow }) {
  useLanguage();
  return (
    <>
      {p.isGuest && <span className="badge bg-slate-100 text-slate-700">{t("بدون حساب")}</span>}
      {p.familyMemberId && p.beneficiary?.relationship && (
        <span className="badge bg-primary-50 text-primary-800">
          {t(RELATIONSHIP_LABELS[p.beneficiary.relationship as keyof typeof RELATIONSHIP_LABELS] ?? "")}
          {p.accountHolderName ? t(" — حساب {0}", { "0": p.accountHolderName }) : ""}
        </span>
      )}
    </>
  );
}

export default function DoctorPatients() {
  useLanguage();
  // البحث والفرز والصفحة في الرابط حتى تبقى عند الرجوع من صفحة أخرى.
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = (["recent", "next", "name"].includes(params.get("sort") ?? "") ? params.get("sort") : "recent") as Sort;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);

  function setParam(next: { q?: string; sort?: Sort; page?: number }) {
    const p = new URLSearchParams(params);
    const merged = { q, sort, page, ...next };
    merged.q ? p.set("q", merged.q) : p.delete("q");
    merged.sort !== "recent" ? p.set("sort", merged.sort) : p.delete("sort");
    merged.page > 1 ? p.set("page", String(merged.page)) : p.delete("page");
    setParams(p, { replace: true });
  }

  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => setParam({ q: search.trim(), page: 1 }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // البحث والتقسيم من الخادم (page/pageSize/q/sort) — لا تحميل كل المرضى في المتصفح.
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["doctor-patients", q, sort, page],
    queryFn: async () =>
      (await api.get<{ data: PatientPage }>("/doctor/patients", { params: { q: q || undefined, sort, page, pageSize: PAGE_SIZE } })).data.data,
    placeholderData: keepPreviousData,
  });

  // «برمجة موعد عودة» من ملف المريض: مرجعه آخر موعد غير ملغى لهذا المستفيد عندك.
  const [followUpCtx, setFollowUpCtx] = useState<FollowUpContext | null>(null);
  const followUp = (p: PatientRow) =>
    p.lastAppointmentId &&
    setFollowUpCtx({
      parentAppointmentId: p.lastAppointmentId,
      beneficiaryName: fullName(p),
      familyMemberId: p.familyMemberId ?? null,
      accountHolderName: p.accountHolderName ?? null,
    });

  const items = data?.items ?? [];
  const rowKey = (p: PatientRow, i: number) => p.key ?? `${p.patientId ?? "guest"}-${p.familyMemberId ?? "self"}-${i}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-slate-900">{t("المرضى")}</h1>
        {data && (
          <p className="text-sm text-slate-600" aria-live="polite">
            {data.total} {q ? t("نتيجة") : t("مريضًا")}
            {isFetching ? t(" · جارٍ التحديث...") : ""}
          </p>
        )}
      </header>

      <FollowUpModal open={Boolean(followUpCtx)} ctx={followUpCtx} onClose={() => setFollowUpCtx(null)} />

      <div className="card grid gap-3 p-3 sm:grid-cols-[1fr_auto] sm:p-4">
        <div className="relative">
          <label htmlFor="patients-search" className="sr-only">{t("بحث بالاسم أو الهاتف ")}</label>
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            id="patients-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("ابحث بالاسم أو رقم الهاتف...")}
            className="input ps-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="patients-sort" className="shrink-0 text-sm font-medium text-slate-700">{t("الترتيب ")}</label>
          <select id="patients-sort" className="input sm:w-64" value={sort} onChange={(e) => setParam({ sort: e.target.value as Sort, page: 1 })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && !data ? (
        <SkeletonRows rows={6} label={t("جارٍ تحميل المرضى...")} />
      ) : isError && !data ? (
        <ErrorState message={apiErrorMessage(error, t("تعذّر تحميل قائمة المرضى."))} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={q ? t("لا نتائج مطابقة للبحث") : t("لا يوجد مرضى بعد")} description={q ? t("تحقق من الاسم أو الرقم.") : undefined} />
      ) : (
        <div className={clsx("transition-opacity", isFetching && "opacity-80")}>
          {/* الهاتف: بطاقات مختصرة، والتفاصيل والإجراءات داخل مساحة قابلة للفتح */}
          <ul className="space-y-2 md:hidden">
            {items.map((p, i) => (
              <li key={rowKey(p, i)} className="card p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <h2 className="min-w-0 truncate text-base font-bold text-slate-900"><bdi translate="no">{fullName(p)}</bdi></h2>
                  <Tags p={p} />
                </div>
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-700" aria-label={t("اتصال بـ{0}", { "0": fullName(p) })}>
                    <Phone className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span className="ltr-nums" translate="no">{p.phone}</span>
                  </a>
                )}
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="min-w-0 rounded-xl bg-slate-50 p-2">
                    <dt className="text-xs text-slate-600">{t("آخر زيارة مكتملة")}</dt>
                    <dd className="truncate font-semibold text-slate-800">
                      <LastVisit v={p.lastCompletedVisit} />
                    </dd>
                  </div>
                  <div className="min-w-0 rounded-xl bg-slate-50 p-2">
                    <dt className="text-xs text-slate-600">{t("الموعد القادم")}</dt>
                    <dd className="truncate font-semibold text-slate-800">
                      <NextAppt v={p.nextAppointment} />
                    </dd>
                  </div>
                </dl>
                <details className="group mt-2">
                  <summary className="flex items-center gap-1 rounded-lg py-1 text-sm font-semibold text-primary-700">
                    <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />{t(" التفاصيل والإجراءات ")}</summary>
                  <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-sm text-slate-700">
                    <p>{t("عدد المواعيد: ")}{p.totalAppointments}</p>
                    {p.email && (
                      <p className="min-w-0 truncate">{t("البريد: ")}<span className="ltr-nums">{p.email}</span>
                      </p>
                    )}
                    {p.lastAppointmentId ? (
                      <Button variant="outline" className="w-full" onClick={() => followUp(p)}>
                        <CalendarPlus className="h-4 w-4" aria-hidden="true" />{t(" برمجة موعد عودة ")}</Button>
                    ) : (
                      p.isGuest ? <GuestFollowUpNotice /> : <p className="text-xs text-slate-600">{t("لا توجد زيارة سابقة مؤهلة لبرمجة العودة.")}</p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>

          {/* الحاسوب: جدول */}
          <div className="card hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{t("قائمة المرضى")}</caption>
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("الاسم")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("الهاتف")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("آخر زيارة مكتملة")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("الموعد القادم")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("المواعيد")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    <span className="sr-only">{t("إجراءات")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((p, i) => (
                  <tr key={rowKey(p, i)}>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800">
                        <bdi translate="no">{fullName(p)}</bdi>
                        <Tags p={p} />
                      </div>
                      {p.email && <div className="ltr-nums mt-0.5 text-xs text-slate-600">{p.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{p.phone ? <span className="ltr-nums" translate="no">{p.phone}</span> : "—"}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <LastVisit v={p.lastCompletedVisit} />
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <NextAppt v={p.nextAppointment} />
                    </td>
                    <td className="px-4 py-3 text-slate-700">{p.totalAppointments}</td>
                    <td className="px-4 py-3">
                      {p.lastAppointmentId ? (
                        <Button variant="outline" className="whitespace-nowrap" onClick={() => followUp(p)}>
                          <CalendarPlus className="h-4 w-4" aria-hidden="true" />{t(" برمجة موعد عودة ")}</Button>
                      ) : p.isGuest ? <GuestFollowUpNotice /> : <span className="text-xs text-slate-500">{t("لا توجد زيارة سابقة مؤهلة لبرمجة العودة.")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={(n) => setParam({ page: n })} />}
        </div>
      )}
    </div>
  );
}
