import { CurrentPatientPlansModal } from "./DoctorTreatmentPlans";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLanguage } from "../../i18n/locale.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, CalendarClock, CalendarPlus, Check, CheckCircle2, Hourglass, Timer } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useLiveUpdates } from "../../context/LiveUpdatesContext";
import { livePollInterval } from "../../lib/livePolling";
import { useToast } from "../../components/ui/Toast";
import { Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { StatCard } from "../../components/StatCard";
import { FollowUpModal, type FollowUpContext } from "../../components/FollowUpModal";
import { GuestBookingModal } from "../../components/GuestBooking";
import { TONE_CLASS, quickActions, subscriptionCountdown, type BadgeTone, type SubscriptionSummary } from "../../lib/doctorHeader";
import { ShiftControl } from "../../components/ShiftControl";
import { useCallNext, useFinishAppointment, useMarkArrived, useQueue } from "../../hooks/useQueue";
import { useMyAppointments } from "../../hooks/useAppointments";
import { appointmentsLink, appointmentsCountAr } from "../../lib/doctorUi";
import { canScheduleFollowUp, isDentalSpecialty, usesStandaloneFollowUp } from "../../lib/features";
import { beneficiaryName, padTurn, visibleTurnNumbers } from "../../lib/appointmentPeople";
import { PrescriptionCard } from "../../components/prescription/PrescriptionCard";
import { awaitingAssistantAdmission, filterQueue, hasUnprintedVisitDraft, nextPresentPatient } from "../../lib/doctorWorkflow";
import { clearPrescriptionDraft, getStoredDraft } from "../../lib/prescription";
import type { Appointment } from "../../types";

// تاريخ اليوم بتوقيت الجزائر (UTC+1) بصيغة YYYY-MM-DD — نفس منطق بقية اللوحة.
const COUNTDOWN_TEXT: Record<BadgeTone, string> = {
  green: "text-emerald-600", blue: "text-primary-700", amber: "text-amber-600", red: "text-red-600", slate: "text-slate-600",
};

function algeriaTodayIso(): string {
  return new Date(Date.now() + 60 * 60000).toISOString().slice(0, 10);
}

const AVATAR_TONES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
];

function Avatar({ name, index }: { name: string; index: number }) {
  useLanguage();
  return (
    <span
      aria-hidden="true"
      className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold", AVATAR_TONES[index % AVATAR_TONES.length])}
    >
      {name.trim().charAt(0) || t("؟")}
    </span>
  );
}

export default function DoctorHome() {
  useLanguage();
  const live = useLiveUpdates();
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const today = algeriaTodayIso();

  const queue = useQueue();
  const appointments = useMyAppointments(undefined, { from: today, to: today });
  const stats = useQuery({
    queryKey: ["doctor-dashboard"],
    queryFn: async () => (await api.get("/doctor/dashboard")).data.data,
    refetchInterval: livePollInterval(live, 30000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const finish = useFinishAppointment();
  const callNext = useCallNext();
  const markArrived = useMarkArrived();
  const canRecordArrival = user?.role === "DOCTOR" && stats.data?.hasActiveAssistant === false;

  const [planSubject, setPlanSubject] = useState<{ patientId: string; memberId: string; name: string } | null>(null);
  const [followUpCtx, setFollowUpCtx] = useState<FollowUpContext | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [finishedCurrentId, setFinishedCurrentId] = useState<string | null>(null);
  const [prescriptionResetKey, setPrescriptionResetKey] = useState(0);
  const prescriptionRef = useRef<HTMLDivElement>(null);
  // إعادة التركيز إلى زر الصف بعد إغلاق القائمة أو نافذة التأكيد أو انتهاء الإجراء.
  const triggerEls = useRef(new Map<string, HTMLElement>());
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const registerTrigger = (id: string) => (el: HTMLElement | null) => {
    if (el) triggerEls.current.set(id, el);
    else triggerEls.current.delete(id);
  };

  const busy = finish.isPending || callNext.isPending || markArrived.isPending;

  // يُنفَّذ بعد انتهاء أي طلب (الأزرار تعود مفعّلة) حتى لا يضيع التركيز على زر معطّل.
  useEffect(() => {
    if (!pendingFocusId || busy || followUpCtx) return;
    const id = pendingFocusId;
    const timer = setTimeout(() => {
      const el = triggerEls.current.get(id);
      if (el?.isConnected) el.focus();
      setPendingFocusId(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingFocusId, busy, followUpCtx]);

  // المواعيد المعروضة اليوم: بلا الملغاة. رقم الدور يُحسب قبل البحث فلا يتغير بتصفية القائمة.
  const todays = useMemo<Appointment[]>(() => (appointments.data ?? []).filter((a) => a.status !== "CANCELLED"), [appointments.data, getLanguage()]);
  const turns = useMemo(() => visibleTurnNumbers(todays), [todays, getLanguage()]);

  const current = queue.data?.current ?? null;
  // أبقِ الوصفة فارغة بعد الإنهاء حتى لو تأخر تحديث الطابور وأعاد المريض المكتمل مؤقتًا.
  const prescriptionCurrent = current?.id === finishedCurrentId ? null : current;
  // الطابور كاملًا بترتيب المناداة الفعلي من الخادم (لا نقتطع منه شيئًا).
  const nextList = queue.data?.ordered ?? [...(queue.data?.waiting ?? []), ...(queue.data?.late ?? [])];
  const awaitingAssistant = awaitingAssistantAdmission(queue.data, stats.data?.hasActiveAssistant);
  const nextPresent = nextPresentPatient(nextList);
  const canCallNext = !current && !awaitingAssistant && Boolean(nextPresent);
  const filteredQueue = filterQueue(nextList, queueSearch);

  function finishCurrent() {
    if (!current || busy) return;
    if (hasUnprintedVisitDraft(getStoredDraft(user?.id), current) && !window.confirm(t("توجد وصفة غير مطبوعة لهذه الزيارة. هل تريد إنهاء الكشف؟ اضغط إلغاء للرجوع إلى الوصفة."))) {
      prescriptionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      prescriptionRef.current?.focus();
      return;
    }
    void run(async () => {
      const completedId = current.id;
      await finish.mutateAsync(completedId);
      const prescription = getStoredDraft(user?.id);
      const belongsToCompletedVisit = prescription?.patient.appointmentId === completedId;
      if (belongsToCompletedVisit) clearPrescriptionDraft();
      setFinishedCurrentId(completedId);
      if (belongsToCompletedVisit) setPrescriptionResetKey(key => key + 1);
      refreshAll();
    }, t("اكتمل الكشف."), "current-card");
  }

  function refreshAll() {
    void qc.invalidateQueries({ queryKey: ["queue"] });
    void qc.invalidateQueries({ queryKey: ["appointments"] });
    void qc.invalidateQueries({ queryKey: ["doctor-dashboard"] });
  }

  async function run(action: () => Promise<unknown>, okMessage: string, focusId?: string) {
    if (busy) return;
    try {
      await action();
      showToast(okMessage, "success");
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
      // الخطأ غالبًا يعني أن الحالة تغيّرت من جهاز آخر (409): نحدّث فورًا بدل انتظار الاستطلاع الدوري.
      refreshAll();
    } finally {
      if (focusId) setPendingFocusId(focusId);
    }
  }

  function openFollowUp(a: Appointment, focusId = a.id) {
    setPendingFocusId(focusId);
    setFollowUpCtx({
      parentAppointmentId: a.id,
      hasAccount: Boolean(a.patientId),
      beneficiaryName: beneficiaryName(a),
      // فرد العائلة يبقى هو المستفيد من موعد العودة، وصاحب الحساب خيار صريح منفصل.
      familyMemberId: a.familyMemberId ?? a.beneficiary?.familyMemberId ?? null,
      accountHolderName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : null,
    });
  }

  // ---- الاشتراك وزر الحجز: من /doctor/dashboard (مصدر الحقيقة في الـ Backend) ----
  const subscription: SubscriptionSummary | null = stats.data?.subscription ?? null;
  const countdown = subscriptionCountdown(subscription);
  // «حجز موعد» يبقى متاحًا للطبيب الذي لا مساعد له فقط (نفس القاعدة السابقة دون تغيير).
  const canBook = quickActions({
    role: user?.role,
    verificationStatus: stats.data?.verificationStatus,
    subscriptionActive: subscription?.active,
    canCreateAppointments: stats.data?.canCreateAppointments,
  }).some((a) => a.id === "book");

  // عند فشل التحميل نعرض «—» بدل 0 حتى لا يُفهم أن العيادة فارغة.
  const waitingCount: number | string = queue.isError ? "—" : queue.data?.waiting.length ?? 0;
  const completedCount: number | string = queue.isError ? "—" : queue.data?.todaySummary?.completed ?? stats.data?.completedToday ?? 0;
  const todayCount: number | string = stats.isError && appointments.isError ? "—" : stats.data?.todayAppointments ?? todays.length;

  return (
    <div className="space-y-5">
      {planSubject && <CurrentPatientPlansModal {...planSubject} onClose={() => setPlanSubject(null)} />}
      <FollowUpModal open={Boolean(followUpCtx)} ctx={followUpCtx} onClose={() => setFollowUpCtx(null)} onDone={refreshAll} />

      <GuestBookingModal open={bookingOpen} onClose={() => setBookingOpen(false)} />

      {/* سطر واحد: زر بدء/إنهاء المداومة في جهة، وعدد أيام الاشتراك في الجهة المقابلة. */}
      <section aria-label={t("المداومة والاشتراك")} className="relative overflow-hidden rounded-xl border border-white/80 bg-white/70 px-3 py-2 shadow-[0_18px_40px_-28px_rgba(15,61,92,0.55)] backdrop-blur-md">
        {/* لمسة ضوئية خفيفة بألوان MedBook */}
        <span aria-hidden="true" className="pointer-events-none absolute -top-16 start-1/3 h-32 w-56 rounded-full bg-primary-200/40 blur-3xl" />
        <div className="relative flex items-center justify-between gap-3">
          <ShiftControl variant="compact" />
          {countdown ? (
            <Link to="/subscription" title={t("تفاصيل الاشتراك")}
              className={clsx("group flex shrink-0 items-center gap-2.5 rounded-xl border-s ps-3 transition sm:ps-5", "border-slate-200/80")}>
              <span className="text-end leading-tight">
                {countdown.days !== null ? (
                  <span className="flex items-baseline justify-end gap-1">
                    <span className={clsx("text-lg font-extrabold tabular-nums", COUNTDOWN_TEXT[countdown.tone])}>{countdown.days}</span>
                    <span className="text-xs font-bold text-slate-600">{countdown.unit}</span>
                  </span>
                ) : (
                  <span className={clsx("block text-sm font-extrabold", COUNTDOWN_TEXT[countdown.tone])}>{countdown.caption}</span>
                )}
                {countdown.days !== null && <span className="block text-[11px] font-semibold text-slate-500">{countdown.caption}</span>}
              </span>
              <span aria-hidden="true" className={clsx("hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-105 sm:flex", TONE_CLASS[countdown.tone])}>
                <Timer className="h-4 w-4" />
              </span>
            </Link>
          ) : stats.isPending ? (
            <span className="h-10 w-28 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />
          ) : null}
        </div>
      </section>
      {canBook && (
        <div className="-mt-2 flex justify-end">
          <button type="button" className="btn-outline !px-3" onClick={() => setBookingOpen(true)}>
            <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden="true" />{t("حجز موعد")}
          </button>
        </div>
      )}

      {/* تنبيهات تظهر فقط حين يلزم إجراء. */}
      {stats.data?.verificationStatus === "PENDING" && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("ملفك قيد المراجعة من الإدارة، ولن تظهر للمرضى حتى تتم الموافقة. ")}</p>
      )}
      {stats.data?.rescheduleRequired > 0 && (
        <Link className="block rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800" to={appointmentsLink({ status: "RESCHEDULE_REQUIRED" })}>
          {appointmentsCountAr(stats.data.rescheduleRequired)}{t(" بحاجة إلى إعادة جدولة — مراجعة المواعيد ")}</Link>
      )}

      {/* 3) ثلاث عدادات */}
      <button type="button" className="btn-outline w-full md:hidden" aria-expanded={statsOpen} aria-controls="doctor-today-stats" onClick={() => setStatsOpen(v => !v)}>{t(statsOpen ? "إخفاء إحصائيات اليوم" : "عرض إحصائيات اليوم")}</button>
      <div id="doctor-today-stats" className={clsx("grid-cols-3 gap-2.5 sm:gap-4 md:grid", statsOpen ? "grid" : "hidden")}>
        <StatCard label={t("مواعيد اليوم")} value={todayCount} icon={CalendarClock} to={appointmentsLink({ from: today, to: today })} />
        <StatCard label={t("في الانتظار")} value={waitingCount} icon={Hourglass} tone="amber" to="/appointments?tab=queue" />
        <StatCard label={t("مكتملة")} value={completedCount} icon={CheckCircle2} tone="green" to={`/appointments?status=COMPLETED&date=${today}`} />
      </div>

      {/* ترتيب DOM: المريض الحالي ← الوصفة ← الطابور، لتبقى كتابة الوصفة مباشرة بعد المريض على الهاتف.
          على الشاشة العريضة يبقى الطابور في العمود الجانبي بجانب البطاقة، والوصفة في مكانها تحتها. */}
      <div className="grid items-start gap-5 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
          {/* 4) المريض الحالي */}
          {/* بعد «إنهاء الكشف»/«استدعاء التالي» يعود التركيز إلى البطاقة نفسها لا إلى زر إجراء آخر:
              ضغطة Enter مكررة يجب ألا تُنهي كشفًا وتنادي مريضًا ثم تُنهيه بالتتابع. */}
          <section ref={registerTrigger("current-card")} tabIndex={-1} className="card p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:p-5 lg:col-span-2" aria-label={t("المريض الحالي")}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">{t(awaitingAssistant ? "في انتظار تأكيد المساعد" : "المريض الحالي")}</h2>
              {current && <span className="badge bg-sky-100 text-sky-700">{t("قيد الكشف")}</span>}
            </div>

            {queue.isPending ? (
              <div className="py-6"><Spinner /></div>
            ) : queue.isError ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {apiErrorMessage(queue.error, t("تعذر تحميل الطابور."))}{" "}
                <button type="button" className="font-semibold underline" onClick={() => void queue.refetch()}>{t("إعادة المحاولة")}</button>
              </p>
            ) : current ? (
              <div className="mt-3 flex items-center gap-4">
                <Avatar name={beneficiaryName(current)} index={0} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xl font-extrabold leading-snug text-slate-900">{beneficiaryName(current)}</p>
                  <p className="mt-1 text-sm text-slate-500">{t("وقت الموعد ")}<span className="font-semibold text-slate-700 tabular-nums">{current.startTime.slice(0, 5)}</span>
                    <span className="mx-2" aria-hidden="true">·</span>{t("رقم الدور ")}<span className="font-semibold text-slate-700 tabular-nums">{padTurn(turns.get(current.id))}</span>
                  </p>
                </div>
              </div>
            ) : (
              <p role="status" className={clsx("mt-3 rounded-xl p-4 text-center", awaitingAssistant ? "border border-primary-200 bg-primary-50 text-primary-900" : "bg-slate-50 text-slate-600")}>{t(awaitingAssistant ? "تم إرسال الطلب إلى المساعد. يبدأ الكشف بعد تأكيد إدخال المريض." : "لا يوجد مريض بالداخل الآن.")}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2 [&>*]:min-w-[9rem]">
              {current?.patientId && isDentalSpecialty(user?.doctor?.specialty) && <Button className="flex-1" variant="outline" onClick={() => setPlanSubject({ patientId: current.patientId!, memberId: current.familyMemberId ?? current.beneficiary?.familyMemberId ?? "", name: beneficiaryName(current) })}>{t("خطط العلاج")}</Button>}
              {/* الاستدعاء يتبع حالة الطابور الفعلية، وإنهاء الكشف أسفل الوصفة. */}
              <Button
                className="flex-1"
                loading={callNext.isPending}
                disabled={busy || queue.isPending || queue.isError || !canCallNext}
                aria-describedby="call-next-hint"
                onClick={() => run(async () => { await callNext.mutateAsync(); }, t("تم إرسال طلب النداء."), "current-card")}
              >{t(awaitingAssistant ? "بانتظار إدخال المريض" : "استدعاء التالي")}<ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              {current && usesStandaloneFollowUp(user?.doctor?.specialty) && (
                <Button
                  className="flex-1"
                  variant="outline"
                  disabled={busy || !canScheduleFollowUp(current)}
                  aria-describedby={!canScheduleFollowUp(current) ? "follow-up-hint" : undefined}
                  onClick={() => openFollowUp(current, "current-card")}
                >
                  <CalendarPlus className="h-4 w-4" aria-hidden="true" />{t(" جدولة موعد آخر ")}</Button>
              )}
            </div>
            <p id="call-next-hint" className="mt-2 text-xs text-slate-500">
              {queue.isError || queue.isPending
                ? t("الاستدعاء غير متاح حتى يُحمَّل الطابور.")
                : awaitingAssistant
                ? t("طلب الإدخال ظاهر لدى المساعد؛ لا حاجة إلى إعادة النداء.")
                : current
                ? t("أنهِ الكشف الحالي أولًا ثم استدعِ التالي.")
                : nextList.length === 0
                ? t("لا يوجد مريض في الانتظار.")
                : !nextPresent
                ? t("بانتظار تسجيل حضور المرضى")
                : t("يُستدعى أول مريض حاضر حسب ترتيب الطابور.")}
            </p>
            {current && usesStandaloneFollowUp(user?.doctor?.specialty) && !canScheduleFollowUp(current) && (
              <p id="follow-up-hint" className="mt-2 text-xs text-slate-500">{t("أكمل اسم المريض ولقبه ورقم هاتفه قبل برمجة المتابعة.")}</p>
            )}
          </section>

        <div ref={prescriptionRef} tabIndex={-1} className="space-y-5 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 lg:col-span-2 lg:row-start-2">
          {/* 6) كتابة وصفة — دون تغيير. مكان «جدول اليوم» سابقًا (دُمج الجدول في صفحة «المواعيد»). */}
          <PrescriptionCard key={prescriptionResetKey} current={prescriptionCurrent} appointments={todays} loading={appointments.isPending} error={appointments.isError} />
          <div className="flex justify-end">
              <Button
                className="w-full sm:w-auto" variant="outline"
                loading={finish.isPending}
                disabled={busy || !current}
                onClick={finishCurrent}
              >
                <Check className="h-4 w-4" aria-hidden="true" />{t(" إنهاء الكشف ")}</Button>
          </div>
          <Link to="/appointments" className="block text-center text-sm font-semibold text-primary-700 hover:underline">
            {t("عرض مواعيد اليوم وإدارتها في «المواعيد»")}
          </Link>
        </div>
        {/* 5) طابور الانتظار — بجانب بطاقة المريض الحالي */}
        <section className="card h-fit p-4 sm:p-5 lg:sticky lg:top-4 lg:col-start-3 lg:row-span-2 lg:row-start-1" aria-label={t("طابور الانتظار")}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-slate-900">{t("طابور الانتظار")}</h2>
            {!queue.isPending && !queue.isError && nextList.length > 0 && <span className="badge bg-amber-100 text-amber-700 tabular-nums">{nextList.length}</span>}
          </div>
          <label className="mt-3 block">
            <span className="sr-only">{t("البحث في الانتظار بالاسم أو الهاتف")}</span>
            <input type="search" className="input" value={queueSearch} onChange={e => setQueueSearch(e.target.value)} placeholder={t("البحث في الانتظار بالاسم أو الهاتف")} />
          </label>
          {queue.isPending ? (
            <div className="py-6"><Spinner /></div>
          ) : queue.isError ? (
            <p role="alert" className="mt-3 text-sm text-red-700">{t("تعذر تحميل ترتيب الطابور.")}</p>
          ) : nextList.length === 0 ? (
            <p className="mt-3 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">{t("لا يوجد منتظرون الآن.")}</p>
          ) : (
            <ol className="mt-2 max-h-[28rem] overflow-y-auto">
              {filteredQueue.map((a) => (
                <li key={a.id} className={clsx("flex items-center gap-3 border-t border-slate-100 py-3 first:border-t-0", a.id === nextPresent?.id && "rounded-xl bg-primary-50/80 px-2 ring-1 ring-inset ring-primary-200")}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-lg font-bold tabular-nums text-primary-700" title={t("رقم الدور حسب وقت الموعد")}>
                    {padTurn(turns.get(a.id))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-bold leading-snug text-slate-900">{beneficiaryName(a)}</p>
                    <p className="text-xs text-slate-500">
                      {a.id === nextPresent?.id && <span className="me-1 font-bold text-primary-700">{t("التالي")} · </span>}{t(a.arrivedAt ? "حاضر — جاهز للنداء" : "لم يصل بعد")}{a.status === "LATE" && <> · {t("متأخر")}</>}{t(" · موعده ")}<span className="tabular-nums">{a.startTime.slice(0, 5)}</span>
                    </p>
                  </div>
                  {!a.arrivedAt && canRecordArrival && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      aria-label={t("تسجيل وصول {0}", { "0": beneficiaryName(a) })}
                      onClick={() => run(() => markArrived.mutateAsync(a.id), t("تم تسجيل وصوله."))}
                    >{t("وصل المريض")}</Button>
                  )}
                  <Avatar name={beneficiaryName(a)} index={nextList.findIndex(item => item.id === a.id) + 1} />
                </li>
              ))}
              {filteredQueue.length === 0 && <li className="p-4 text-center text-sm text-slate-600">{t("لا توجد نتائج مطابقة.")}</li>}
            </ol>
          )}
          <p className="mt-3 text-xs text-slate-500">{t("الترتيب هنا هو ترتيب المناداة الفعلي من الخادم، وقد يختلف عن رقم الدور المرئي.")}</p>
        </section>

      </div>
    </div>
  );
}
