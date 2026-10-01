import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, CalendarClock, CheckCircle2, CircleDashed, ClipboardList, XCircle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner } from "../../components/ui/States";
import type { PatientTreatmentPlan } from "../../types";
import { beneficiaryLabel } from "../../lib/family";

/**
 * «خطط العلاج» — قراءة فقط: خطط صاحب الحساب وأفراد عائلته، جلساتها ومتابعاتها المستحقة.
 * لا تعديل من المريض، ولا ملاحظات الطبيب الداخلية (الخادم لا يرسلها أصلًا)، ولا تخزين على الجهاز.
 */
const PLAN_STATUS: Record<PatientTreatmentPlan["status"], { label: string; cls: string }> = {
  ACTIVE: { label: "جارية", cls: "bg-primary-50 text-primary-800" },
  COMPLETED: { label: "مكتملة", cls: "bg-emerald-50 text-emerald-800" },
  CANCELLED: { label: "ملغاة", cls: "bg-slate-100 text-slate-600" },
};
const FOLLOW_UP_LABEL = { DUE: "مستحقة", SCHEDULED: "مبرمجة بموعد", COMPLETED: "تمت", DISMISSED: "—" } as const;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ar-DZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function SessionIcon({ status }: { status: "PLANNED" | "COMPLETED" | "CANCELLED" }) {
  if (status === "COMPLETED") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="مكتملة" />;
  if (status === "CANCELLED") return <XCircle className="h-4 w-4 shrink-0 text-slate-400" aria-label="ملغاة" />;
  return <CircleDashed className="h-4 w-4 shrink-0 text-slate-400" aria-label="مخطّطة" />;
}

export default function TreatmentPlans() {
  const { user, loading } = useAuth();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["patient-treatment-plans"],
    queryFn: async () => (await api.get<{ data: PatientTreatmentPlan[] }>("/patient/treatment-plans")).data.data,
    enabled: Boolean(user),
    retry: false,
  });

  if (loading) return <Spinner label="جارٍ التحميل..." />;
  if (!user) return <Navigate to="/account/login?redirect=%2Faccount%2Ftreatment-plans" replace />;

  return (
    <div className="container-app py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <Link to="/account" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-700">
          <ArrowRight className="h-4 w-4" aria-hidden="true" /> العودة إلى حسابي
        </Link>
        <div className="glass p-5">
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
            <ClipboardList className="h-5 w-5" aria-hidden="true" /> خطط العلاج
          </h1>
          <p className="mt-1 text-sm text-slate-600">خطط العلاج التي وضعها طبيب الأسنان لك ولأفراد عائلتك، ومواعيد المتابعة القادمة.</p>
        </div>

        {isLoading ? (
          <Spinner label="جارٍ تحميل الخطط..." />
        ) : isError ? (
          <div className="glass p-4 text-sm text-red-600" role="alert">
            {apiErrorMessage(error, "تعذّر تحميل خطط العلاج.")}{" "}
            <button type="button" className="font-semibold underline" onClick={() => refetch()}>إعادة المحاولة</button>
          </div>
        ) : (data ?? []).length === 0 ? (
          <p className="glass p-4 text-sm text-slate-500">لا توجد خطط علاج بعد. تظهر هنا عندما يضع لك طبيب الأسنان خطة متعددة الجلسات.</p>
        ) : (
          <ul className="space-y-4">
            {data!.map((p) => {
              const done = p.sessions.filter((s) => s.status === "COMPLETED").length;
              const nextFollowUp = p.followUps.find((f) => f.status === "DUE" || f.status === "SCHEDULED");
              return (
                <li key={p.id} className="glass p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{p.title}</p>
                      <p className="text-xs text-slate-500">
                        د. {p.doctor.firstName} {p.doctor.lastName} · {beneficiaryLabel(p.beneficiary)}
                      </p>
                    </div>
                    <span className={clsx("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", PLAN_STATUS[p.status].cls)}>{PLAN_STATUS[p.status].label}</span>
                  </div>
                  {p.description && <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-600">{p.description}</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    الجلسات: {done} من {p.sessions.length || p.estimatedSessions || 0}
                    {p.estimatedTotalCost != null && <> · التكلفة التقديرية: {p.estimatedTotalCost.toLocaleString("ar-DZ")} دج</>}
                  </p>
                  {p.sessions.length > 0 && (
                    <ol className="mt-3 space-y-1.5">
                      {p.sessions.map((s) => (
                        <li key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <SessionIcon status={s.status} />
                          <span className="font-semibold">{s.sessionNumber}.</span> <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          {s.appointment && <span className="shrink-0 text-xs text-slate-500" dir="ltr">{s.appointment.date.slice(0, 10)} {s.appointment.startTime}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {nextFollowUp && (
                    <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-900">
                      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      متابعة {FOLLOW_UP_LABEL[nextFollowUp.status]}:{" "}
                      {nextFollowUp.appointment ? (
                        <Link to={`/account?appointment=${nextFollowUp.appointment.id}`} className="font-semibold underline">
                          {fmtDate(nextFollowUp.appointment.date)} الساعة {nextFollowUp.appointment.startTime}
                        </Link>
                      ) : (
                        <span className="font-semibold">حوالي {fmtDate(nextFollowUp.dueDate)}</span>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
