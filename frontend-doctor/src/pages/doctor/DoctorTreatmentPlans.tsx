import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowRight, ArrowUp, CalendarClock, CalendarPlus, CheckCircle2, ClipboardList, Plus } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input, Select, Textarea } from "../../components/ui/Input";
import { useToast } from "../../components/ui/Toast";
import { FollowUpModal, type FollowUpContext } from "../../components/FollowUpModal";
import { RELATIONSHIP_LABELS } from "../../lib/features";
import type { PlanCandidate, TreatmentPlanDetail, TreatmentPlanSummary } from "../../types";

/**
 * «خطط العلاج» (أطباء الأسنان): خطط متعددة الجلسات لمرضى سبق أن حجزوا عندك أو لأفراد عائلاتهم.
 * كل الصلاحيات في الخادم (طبيب الأسنان المالك فقط). بلا رسائل هاتفية ولا Push: المتابعات تظهر هنا وفي حساب المريض.
 */
const PLAN_STATUS = {
  ACTIVE: { label: "جارية", cls: "bg-primary-50 text-primary-800" },
  COMPLETED: { label: "مكتملة", cls: "bg-emerald-50 text-emerald-800" },
  CANCELLED: { label: "ملغاة", cls: "bg-slate-100 text-slate-600" },
} as const;
const FOLLOW_UP_STATUS = {
  DUE: { label: "مستحقة", cls: "bg-amber-50 text-amber-800" },
  SCHEDULED: { label: "مبرمجة بموعد", cls: "bg-primary-50 text-primary-800" },
  COMPLETED: { label: "تمت", cls: "bg-emerald-50 text-emerald-800" },
  DISMISSED: { label: "متجاهَلة", cls: "bg-slate-100 text-slate-500" },
} as const;
const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : "—");

function beneficiaryLine(p: { beneficiary: TreatmentPlanSummary["beneficiary"] }) {
  const b = p.beneficiary;
  return b.type === "FAMILY_MEMBER" && b.relationship ? `${b.name} (${t(RELATIONSHIP_LABELS[b.relationship])})` : b.name;
}

function CreatePlanForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  useLanguage();
  const { showToast } = useToast();
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sessions, setSessions] = useState("");
  const [cost, setCost] = useState("");
  const candidates = useQuery({
    queryKey: ["treatment-candidates"],
    queryFn: async () => (await api.get<{ data: PlanCandidate[] }>("/doctor/treatment-plans/candidates")).data.data,
  });
  const create = useMutation({
    mutationFn: async () => {
      const [patientId, familyMemberId] = subject.split("|");
      return (
        await api.post("/doctor/treatment-plans", {
          patientId,
          familyMemberId: familyMemberId || null,
          title,
          description: description || null,
          estimatedSessions: sessions ? Number(sessions) : null,
          estimatedTotalCost: cost ? Number(cost) : null,
        })
      ).data.data as TreatmentPlanDetail;
    },
    onSuccess: (p) => { showToast(t("تم إنشاء خطة العلاج."), "success"); onCreated(p.id); },
    onError: (e) => showToast(apiErrorMessage(e, t("تعذّر إنشاء الخطة.")), "error"),
  });

  return (
    <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); if (subject && title.trim().length >= 2) create.mutate(); }}>
      <h2 className="font-bold text-slate-900">{t("خطة علاج جديدة")}</h2>
      {candidates.isLoading ? (
        <Spinner label={t("جارٍ تحميل المرضى...")} />
      ) : candidates.isError ? (
        <p className="text-sm text-red-600" role="alert">{apiErrorMessage(candidates.error, t("تعذّر تحميل المرضى."))}</p>
      ) : (candidates.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-500">{t("لا يوجد بعد مرضى بحساب حجزوا عندك. تُنشأ الخطة لمريض سبق أن حجز لديك.")}</p>
      ) : (
        <Select label={t("المريض / المستفيد")} value={subject} onChange={(e) => setSubject(e.target.value)} required>
          <option value="">{t("اختر")}</option>
          {candidates.data!.map((c) => (
            <optgroup key={c.id} label={`${c.firstName} ${c.lastName}`}>
              <option value={`${c.id}|`}>{c.firstName} {c.lastName}{t(" (صاحب الحساب)")}</option>
              {c.familyMembers.map((m) => (
                <option key={m.id} value={`${c.id}|${m.id}`}>
                  {m.firstName} {m.lastName} — {t(RELATIONSHIP_LABELS[m.relationship] ?? "")}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
      <Input label={t("عنوان الخطة")} placeholder={t("مثال: علاج عصب + تاج")} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Textarea label={t("وصف (اختياري)")} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Input label={t("عدد الجلسات التقديري")} type="number" min={1} max={100} value={sessions} onChange={(e) => setSessions(e.target.value)} />
        <Input label={t("التكلفة التقديرية (دج)")} type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={create.isPending} disabled={!subject || title.trim().length < 2}>{t("إنشاء الخطة")}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{t("إلغاء")}</Button>
      </div>
    </form>
  );
}

function PlanDetail({ planId, onBack }: { planId: string; onBack: () => void }) {
  useLanguage();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [followUpCtx, setFollowUpCtx] = useState<FollowUpContext | null>(null);
  const [customDue, setCustomDue] = useState("");

  const q = useQuery({
    queryKey: ["treatment-plan", planId],
    queryFn: async () => (await api.get<{ data: TreatmentPlanDetail }>(`/doctor/treatment-plans/${planId}`)).data.data,
  });
  const refresh = (data?: TreatmentPlanDetail) => {
    if (data) qc.setQueryData(["treatment-plan", planId], data);
    qc.invalidateQueries({ queryKey: ["treatment-plans"] });
  };
  const run = useMutation({
    mutationFn: async (fn: () => Promise<{ data: { data: TreatmentPlanDetail } }>) => (await fn()).data.data,
    onSuccess: (d) => refresh(d),
    onError: (e) => showToast(apiErrorMessage(e, t("تعذّر الحفظ.")), "error"),
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <p className="card p-4 text-sm text-red-600" role="alert">{apiErrorMessage(q.error, t("تعذّر تحميل الخطة."))}</p>;
  const p = q.data;
  const active = p.status === "ACTIVE";
  // مرجع موعد العودة: آخر موعد غير ملغى لنفس المستفيد عندك (يحسبه الخادم).
  const anchorAppointmentId = p.anchorAppointmentId ?? undefined;

  const move = (idx: number, dir: -1 | 1) => {
    const ids = p.sessions.map((s) => s.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    run.mutate(() => api.put(`/doctor/treatment-plans/${p.id}/sessions/order`, { sessionIds: ids }));
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-700">
        <ArrowRight className="h-4 w-4" />{t(" كل الخطط ")}</button>

      <FollowUpModal open={Boolean(followUpCtx)} ctx={followUpCtx} onClose={() => setFollowUpCtx(null)} onDone={() => q.refetch()} />

      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">{p.title}</h2>
            <p className="text-sm text-slate-500">{beneficiaryLine(p)}</p>
          </div>
          <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold", PLAN_STATUS[p.status].cls)}>{t(PLAN_STATUS[p.status].label)}</span>
        </div>
        {p.description && <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-600">{p.description}</p>}
        <p className="mt-2 text-xs text-slate-500">{t("بدأت ")}{day(p.startedAt)}
          {p.estimatedSessions ? t(" · {0} جلسات تقديرًا", { "0": p.estimatedSessions }) : ""}
          {p.estimatedTotalCost != null ? t(" · {0} دج", { "0": p.estimatedTotalCost.toLocaleString("ar-DZ") }) : ""}
        </p>
        {active && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.confirm(t("إكمال الخطة؟ لن يمكن تعديل جلساتها بعد ذلك.")) && run.mutate(() => api.patch(`/doctor/treatment-plans/${p.id}`, { status: "COMPLETED" }))}>
              <CheckCircle2 className="h-4 w-4" />{t(" إكمال الخطة ")}</Button>
            <Button variant="ghost" onClick={() => window.confirm(t("إلغاء الخطة نهائيًا؟")) && run.mutate(() => api.patch(`/doctor/treatment-plans/${p.id}`, { status: "CANCELLED" }))}>{t("إلغاء الخطة ")}</Button>
          </div>
        )}
      </div>

      <section className="card p-4">
        <h3 className="mb-3 font-bold text-slate-900">{t("الجلسات")}</h3>
        {p.sessions.length === 0 ? (
          <p className="text-sm text-slate-500">{t("لا جلسات بعد.")}</p>
        ) : (
          <ol className="space-y-2">
            {p.sessions.map((s, i) => (
              <li key={s.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">
                    {s.sessionNumber}. {s.title}{" "}
                    {s.status === "COMPLETED" && <span className="text-xs text-emerald-700">{t("(مكتملة ")}{day(s.completedAt)})</span>}
                    {s.status === "CANCELLED" && <span className="text-xs text-slate-400">{t("(ملغاة)")}</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {s.appointment ? t("الموعد: {0} {1}", { "0": day(s.appointment.date), "1": s.appointment.startTime }) : s.plannedDate ? t("مخطّطة: {0}", { "0": day(s.plannedDate) }) : t("بلا موعد")}
                  </p>
                  {s.notes && <p className="mt-1 whitespace-pre-line break-words text-xs text-slate-500">{t("ملاحظة: ")}{s.notes}</p>}
                </div>
                {active && (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <button type="button" aria-label={t("أعلى")} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30" disabled={i === 0 || run.isPending} onClick={() => move(i, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={t("أسفل")} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30" disabled={i === p.sessions.length - 1 || run.isPending} onClick={() => move(i, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    {s.status === "PLANNED" && (
                      <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate(() => api.patch(`/doctor/treatment-sessions/${s.id}`, { status: "COMPLETED" }))}>{t("إكمال ")}</Button>
                    )}
                    {s.status === "PLANNED" && !s.appointment && anchorAppointmentId && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          setFollowUpCtx({ parentAppointmentId: anchorAppointmentId, beneficiaryName: p.beneficiary.name, treatmentPlanId: p.id, treatmentSessionId: s.id, suggestedDate: s.plannedDate?.slice(0, 10) })
                        }
                      >
                        <CalendarPlus className="h-4 w-4" />{t(" برمجة موعد عودة ")}</Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {active && (
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (sessionTitle.trim().length < 2) return;
              run.mutate(() => api.post(`/doctor/treatment-plans/${p.id}/sessions`, { title: sessionTitle, plannedDate: sessionDate || null }), {
                onSuccess: () => { setSessionTitle(""); setSessionDate(""); },
              });
            }}
          >
            <div className="flex-1"><Input label={t("جلسة جديدة")} placeholder={t("مثال: حشو الضرس 36")} maxLength={120} value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} /></div>
            <Input label={t("تاريخ مخطّط (اختياري)")} type="date" dir="ltr" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
            <Button type="submit" loading={run.isPending}><Plus className="h-4 w-4" />{t(" إضافة")}</Button>
          </form>
        )}
        {!anchorAppointmentId && active && (
          <p className="mt-2 text-xs text-slate-500">{t("لا يوجد موعد سابق لهذا المستفيد عندك، لذلك لا يمكن برمجة موعد عودة من هنا بعد.")}</p>
        )}
      </section>

      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-900"><CalendarClock className="h-4 w-4" />{t(" المتابعات")}</h3>
        {p.followUps.length === 0 ? (
          <p className="text-sm text-slate-500">{t("لا متابعات. أضف متابعة بعد 6 أشهر للمراجعة الدورية.")}</p>
        ) : (
          <ul className="space-y-2">
            {p.followUps.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {f.appointment ? t("موعد {0} {1}", { "0": day(f.appointment.date), "1": f.appointment.startTime }) : t("مستحقة حوالي {0}", { "0": day(f.dueDate) })}
                  </p>
                  <span className={clsx("mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold", FOLLOW_UP_STATUS[f.status].cls)}>{t(FOLLOW_UP_STATUS[f.status].label)}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {f.status === "DUE" && anchorAppointmentId && p.status !== "CANCELLED" && (
                    <Button
                      variant="outline"
                      onClick={() => setFollowUpCtx({ parentAppointmentId: anchorAppointmentId, beneficiaryName: p.beneficiary.name, treatmentPlanId: p.id, dentalFollowUpId: f.id, suggestedDate: f.dueDate.slice(0, 10) })}
                    >
                      <CalendarPlus className="h-4 w-4" />{t(" برمجة موعد عودة ")}</Button>
                  )}
                  {(f.status === "DUE" || f.status === "SCHEDULED") && (
                    <Button variant="ghost" disabled={run.isPending} onClick={() => run.mutate(() => api.patch(`/doctor/treatment-follow-ups/${f.id}`, { status: "COMPLETED" }))}>{t("تمت")}</Button>
                  )}
                  {f.status === "DUE" && (
                    <Button variant="ghost" disabled={run.isPending} onClick={() => run.mutate(() => api.patch(`/doctor/treatment-follow-ups/${f.id}`, { status: "DISMISSED" }))}>{t("تجاهل")}</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {p.status !== "CANCELLED" && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate(() => api.post(`/doctor/treatment-plans/${p.id}/follow-ups`, { afterMonths: 6 }))}>
              <Plus className="h-4 w-4" />{t(" متابعة بعد 6 أشهر ")}</Button>
            <Input label={t("أو بتاريخ محدد")} type="date" dir="ltr" value={customDue} onChange={(e) => setCustomDue(e.target.value)} />
            <Button variant="outline" disabled={!customDue || run.isPending} onClick={() => run.mutate(() => api.post(`/doctor/treatment-plans/${p.id}/follow-ups`, { dueDate: customDue }), { onSuccess: () => setCustomDue("") })}>{t("إضافة ")}</Button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function DoctorTreatmentPlans() {
  useLanguage();
  const [params, setParams] = useSearchParams();
  const planId = params.get("plan");
  const [creating, setCreating] = useState(false);
  const plans = useQuery({
    queryKey: ["treatment-plans"],
    queryFn: async () => (await api.get<{ data: TreatmentPlanSummary[] }>("/doctor/treatment-plans")).data.data,
    retry: false,
  });
  const open = (id: string | null) => setParams(id ? { plan: id } : {}, { replace: false });

  return (
    <div className="space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900"><ClipboardList className="h-6 w-6" />{t(" خطط العلاج")}</h1>

      {planId ? (
        <PlanDetail planId={planId} onBack={() => open(null)} />
      ) : plans.isLoading ? (
        <Spinner />
      ) : plans.isError ? (
        <p className="card p-4 text-sm text-red-600" role="alert">{apiErrorMessage(plans.error, t("تعذّر تحميل الخطط."))}</p>
      ) : (
        <>
          {creating ? (
            <CreatePlanForm onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); plans.refetch(); open(id); }} />
          ) : (
            <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{t(" خطة علاج جديدة")}</Button>
          )}
          {(plans.data?.length ?? 0) === 0 ? (
            <EmptyState title={t("لا توجد خطط علاج بعد")} description={t("أنشئ خطة متعددة الجلسات لمريض سبق أن حجز عندك.")} />
          ) : (
            <ul className="space-y-3">
              {plans.data!.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => open(p.id)} className="card flex w-full flex-col gap-1 p-4 text-start transition hover:border-primary-300">
                    <span className="flex w-full items-start justify-between gap-2">
                      <span className="font-bold text-slate-900">{p.title}</span>
                      <span className={clsx("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", PLAN_STATUS[p.status].cls)}>{t(PLAN_STATUS[p.status].label)}</span>
                    </span>
                    <span className="text-sm text-slate-500">{beneficiaryLine(p)}</span>
                    <span className="text-xs text-slate-500">{t("الجلسات: ")}{p.completedSessions}/{p.sessionsCount}
                      {p.nextFollowUp ? t(" · متابعة {0}: {1}", { "0": FOLLOW_UP_STATUS[p.nextFollowUp.status].label, "1": day(p.nextFollowUp.dueDate) }) : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
