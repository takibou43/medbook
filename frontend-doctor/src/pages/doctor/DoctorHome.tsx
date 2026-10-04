import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ArrowLeft, CalendarClock, CalendarPlus, Check, CheckCircle2, Hourglass, MoreHorizontal, Search } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { AppointmentStatusBadge, VerificationBadge } from "../../components/ui/Badge";
import { StatCard } from "../../components/StatCard";
import { FollowUpModal, type FollowUpContext } from "../../components/FollowUpModal";
import { NoShowSmsDialog, type NoShowTarget } from "../../components/NoShowSmsDialog";
import { useCallNext, useCallPatient, useFinishAppointment, useMarkLate, useQueue } from "../../hooks/useQueue";
import { useMyAppointments, useUpdateAppointmentStatus } from "../../hooks/useAppointments";
import { appointmentActions, appointmentsLink, appointmentsCountAr } from "../../lib/doctorUi";
import { canScheduleFollowUp } from "../../lib/features";
import { appointmentPhone, beneficiaryName, padTurn, visibleTurnNumbers } from "../../lib/appointmentPeople";
import type { Appointment } from "../../types";

// تاريخ اليوم بتوقيت الجزائر (UTC+1) بصيغة YYYY-MM-DD — نفس منطق بقية اللوحة.
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
  return (
    <span
      aria-hidden="true"
      className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold", AVATAR_TONES[index % AVATAR_TONES.length])}
    >
      {name.trim().charAt(0) || "؟"}
    </span>
  );
}

/** الحالات التي يسمح الخادم فيها بتسجيل «متأخر» (markAsLate). */
const LATE_ALLOWED = ["CONFIRMED", "IN_PROGRESS", "LATE"];
/** الحالات التي يسمح الخادم فيها بمناداة موعد بعينه (callSpecificPatient). */
const CALL_ALLOWED = ["CONFIRMED", "LATE"];

interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** معطّل بقرار من قواعد الخادم: يبقى قابلًا للتركيز ليُقرأ سببه، لكنه لا يُنفَّذ. */
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
}

/**
 * قائمة «…» لإجراءات صف واحد بنمط menu button: Enter/Space/السهم لفتحها، الأسهم وHome/End للتنقل،
 * Escape يغلقها ويعيد التركيز إلى زرّها، وTab يغلقها ويكمل التنقل الطبيعي.
 */
function RowActionsMenu({
  label, open, onOpenChange, disabled, openUpward, triggerRef, items,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  openUpward?: boolean;
  triggerRef: (el: HTMLButtonElement | null) => void;
  items: RowMenuItem[];
}) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  const focusItem = (index: number) => {
    const els = menuItems();
    if (els.length) els[(index + els.length) % els.length].focus();
  };

  useEffect(() => {
    if (open) focusItem(0);
  }, [open]);

  function close(returnFocus: boolean) {
    onOpenChange(false);
    // setTimeout لا requestAnimationFrame: الأخير يتوقف تمامًا في التبويبات غير الظاهرة.
    if (returnFocus) setTimeout(() => buttonRef.current?.focus(), 0);
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const els = menuItems();
    const index = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(index + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(index - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(els.length - 1); }
    else if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Tab") close(false);
  }

  return (
    <div className="relative">
      <button
        ref={(el) => { buttonRef.current = el; triggerRef(el); }}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); onOpenChange(true); }
        }}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:border-primary-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 disabled:opacity-50"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-30" onClick={() => close(false)} />
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            className={clsx("absolute left-0 z-40 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-lg", openUpward ? "bottom-full mb-1" : "mt-1")}
          >
            {items.map((item) => (
              <button
                key={item.key}
                role="menuitem"
                type="button"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return;
                  onOpenChange(false);
                  item.onSelect();
                }}
                className={clsx(
                  "block w-full rounded-lg px-3 py-2 text-right text-sm outline-none focus:bg-slate-100",
                  item.danger ? "text-red-700 hover:bg-red-50" : "hover:bg-slate-50",
                  item.disabled && "cursor-not-allowed opacity-60"
                )}
              >
                {item.label}
                {item.disabled && item.hint && <span className="block text-[11px] font-normal text-slate-500">{item.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function DoctorHome() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const today = algeriaTodayIso();

  const queue = useQueue();
  const appointments = useMyAppointments(undefined, { from: today, to: today });
  const stats = useQuery({
    queryKey: ["doctor-dashboard"],
    queryFn: async () => (await api.get("/doctor/dashboard")).data.data,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const finish = useFinishAppointment();
  const callNext = useCallNext();
  const callPatient = useCallPatient();
  const markLate = useMarkLate();
  const updateStatus = useUpdateAppointmentStatus();

  const [search, setSearch] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [followUpCtx, setFollowUpCtx] = useState<FollowUpContext | null>(null);
  const [noShowTarget, setNoShowTarget] = useState<NoShowTarget | null>(null);
  // إعادة التركيز إلى زر الصف بعد إغلاق القائمة أو نافذة التأكيد أو انتهاء الإجراء.
  const triggerEls = useRef(new Map<string, HTMLElement>());
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const registerTrigger = (id: string) => (el: HTMLElement | null) => {
    if (el) triggerEls.current.set(id, el);
    else triggerEls.current.delete(id);
  };

  const doctor = user?.doctor;
  const busy = finish.isPending || callNext.isPending || callPatient.isPending || markLate.isPending || updateStatus.isPending;

  // يُنفَّذ بعد انتهاء أي طلب (الأزرار تعود مفعّلة) حتى لا يضيع التركيز على زر معطّل.
  useEffect(() => {
    if (!pendingFocusId || busy || noShowTarget || followUpCtx) return;
    const id = pendingFocusId;
    const timer = setTimeout(() => {
      const el = triggerEls.current.get(id);
      if (el?.isConnected) el.focus();
      setPendingFocusId(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingFocusId, busy, noShowTarget, followUpCtx]);

  // المواعيد المعروضة اليوم: بلا الملغاة. رقم الدور يُحسب قبل البحث فلا يتغير بتصفية القائمة.
  const todays = useMemo<Appointment[]>(() => (appointments.data ?? []).filter((a) => a.status !== "CANCELLED"), [appointments.data]);
  const turns = useMemo(() => visibleTurnNumbers(todays), [todays]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return todays;
    const qDigits = q.replace(/\D/g, "");
    return todays.filter((a) => {
      if (beneficiaryName(a).toLowerCase().includes(q)) return true;
      const phone = (appointmentPhone(a) ?? "").replace(/\D/g, "");
      return qDigits.length > 0 && phone.includes(qDigits);
    });
  }, [todays, search]);

  const current = queue.data?.current ?? null;
  const nextList = (queue.data?.ordered ?? [...(queue.data?.waiting ?? []), ...(queue.data?.late ?? [])]).slice(0, 3);
  const canCallNext = !current && nextList.length > 0;

  function refreshAll() {
    void qc.invalidateQueries({ queryKey: ["queue"] });
    void qc.invalidateQueries({ queryKey: ["appointments"] });
    void qc.invalidateQueries({ queryKey: ["doctor-dashboard"] });
  }

  async function run(action: () => Promise<unknown>, okMessage: string, focusId?: string) {
    if (busy) return;
    setMenuId(null);
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
    setMenuId(null);
    setPendingFocusId(focusId);
    setFollowUpCtx({
      parentAppointmentId: a.id,
      beneficiaryName: beneficiaryName(a),
      // فرد العائلة يبقى هو المستفيد من موعد العودة، وصاحب الحساب خيار صريح منفصل.
      familyMemberId: a.familyMemberId ?? a.beneficiary?.familyMemberId ?? null,
      accountHolderName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : null,
    });
  }

  function openNoShow(a: Appointment) {
    setMenuId(null);
    setPendingFocusId(a.id);
    setNoShowTarget({
      id: a.id,
      patientName: beneficiaryName(a),
      phone: appointmentPhone(a),
      date: a.date,
      startTime: a.startTime,
      alreadyNoShow: a.status === "NO_SHOW",
    });
  }

  async function recordNoShow(id: string) {
    try {
      const res = await updateStatus.mutateAsync({ id, status: "NO_SHOW" });
      showToast("تم تسجيل المريض كـ «لم يحضر».", "success");
      refreshAll();
      return res;
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
      refreshAll();
      throw err;
    }
  }

  // ---- اشتراك/توثيق: تنبيهات مختصرة ----
  const clinicSubscription = user?.doctor?.clinic?.ownerId ? user.doctor.clinic : null;
  const effectiveExpiry = clinicSubscription ? clinicSubscription.subscriptionExpiresAt : user?.doctor?.subscriptionExpiresAt;
  const endsAt = effectiveExpiry ? new Date(effectiveExpiry) : null;
  const validEnd = endsAt && !isNaN(endsAt.getTime()) ? endsAt : null;
  const daysLeft = validEnd ? Math.max(0, Math.ceil((validEnd.getTime() - Date.now()) / 86400000)) : null;

  // عند فشل التحميل نعرض «—» بدل 0 حتى لا يُفهم أن العيادة فارغة.
  const waitingCount: number | string = queue.isError ? "—" : queue.data?.waiting.length ?? 0;
  const completedCount: number | string = queue.isError ? "—" : queue.data?.todaySummary?.completed ?? stats.data?.completedToday ?? 0;
  const todayCount: number | string = stats.isError && appointments.isError ? "—" : stats.data?.todayAppointments ?? todays.length;

  return (
    <div className="space-y-5">
      <NoShowSmsDialog target={noShowTarget} onConfirm={recordNoShow} onClose={() => setNoShowTarget(null)} />
      <FollowUpModal open={Boolean(followUpCtx)} ctx={followUpCtx} onClose={() => setFollowUpCtx(null)} onDone={refreshAll} />

      {/* ترحيب */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            مرحباً {doctor ? `د. ${doctor.firstName} ${doctor.lastName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-500">إدارة عيادتك بسهولة</p>
        </div>
        {stats.data && <VerificationBadge status={stats.data.verificationStatus} />}
      </header>

      {/* تنبيهات مختصرة */}
      {stats.data?.verificationStatus === "PENDING" && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ملفك قيد المراجعة من الإدارة، ولن تظهر للمرضى حتى تتم الموافقة.
        </p>
      )}
      {clinicSubscription ? (
        <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-800">اشتراكك مشمول في اشتراك {clinicSubscription.nameAr}.</p>
      ) : (
        daysLeft !== null &&
        validEnd && (
          <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {daysLeft > 0
              ? `اشتراكك المجاني ينتهي بعد ${daysLeft} ${daysLeft === 1 ? "يوم" : "أيام"}، وبعده يتوقف ظهورك للمرضى حتى التجديد.`
              : "انتهت مدة اشتراكك المجاني. تواصل مع الإدارة للتجديد والعودة إلى الظهور للمرضى."}
          </p>
        )
      )}
      {stats.data?.rescheduleRequired > 0 && (
        <Link className="block rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800" to={appointmentsLink({ status: "RESCHEDULE_REQUIRED" })}>
          {appointmentsCountAr(stats.data.rescheduleRequired)} بحاجة إلى إعادة جدولة — مراجعة المواعيد
        </Link>
      )}

      {/* بطاقات */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatCard label="مواعيد اليوم" value={todayCount} icon={CalendarClock} to={appointmentsLink({ from: today, to: today })} />
        <StatCard label="في الانتظار" value={waitingCount} icon={Hourglass} tone="amber" to="/appointments?tab=queue" />
        <StatCard label="مكتملة" value={completedCount} icon={CheckCircle2} tone="green" to={`/appointments?status=COMPLETED&date=${today}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* المريض الحالي */}
          {/* بعد «إنهاء الكشف»/«استدعاء التالي» يعود التركيز إلى البطاقة نفسها لا إلى زر إجراء آخر:
              ضغطة Enter مكررة يجب ألا تُنهي كشفًا وتنادي مريضًا ثم تُنهيه بالتتابع. */}
          <section ref={registerTrigger("current-card")} tabIndex={-1} className="card p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:p-5" aria-label="المريض الحالي">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">المريض الحالي</h2>
              {current && <span className="badge bg-sky-100 text-sky-700">قيد الكشف</span>}
            </div>

            {queue.isPending ? (
              <div className="py-6"><Spinner /></div>
            ) : queue.isError ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {apiErrorMessage(queue.error, "تعذر تحميل الطابور.")}{" "}
                <button type="button" className="font-semibold underline" onClick={() => void queue.refetch()}>إعادة المحاولة</button>
              </p>
            ) : current ? (
              <div className="mt-3 flex items-center gap-4">
                <Avatar name={beneficiaryName(current)} index={0} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xl font-extrabold leading-snug text-slate-900">{beneficiaryName(current)}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    وقت الموعد <span className="font-semibold text-slate-700 tabular-nums">{current.startTime}</span>
                    <span className="mx-2" aria-hidden="true">·</span>
                    رقم الدور <span className="font-semibold text-slate-700 tabular-nums">{padTurn(turns.get(current.id))}</span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-slate-50 p-4 text-center text-slate-600">لا يوجد مريض بالداخل الآن.</p>
            )}

            <div className="mt-4 flex gap-2">
              {current && (
                <Button
                  className="flex-1"
                  loading={finish.isPending}
                  disabled={busy}
                  onClick={() => run(async () => { await finish.mutateAsync(current.id); refreshAll(); }, "اكتمل الكشف.", "current-card")}
                >
                  <Check className="h-4 w-4" aria-hidden="true" /> إنهاء الكشف
                </Button>
              )}
              {current ? (
                <Button
                  className="flex-1"
                  variant="outline"
                  disabled={busy || !canScheduleFollowUp(current)}
                  aria-describedby={!canScheduleFollowUp(current) ? "follow-up-hint" : undefined}
                  onClick={() => openFollowUp(current, "current-card")}
                >
                  <CalendarPlus className="h-4 w-4" aria-hidden="true" /> جدولة موعد آخر
                </Button>
              ) : (
              <Button
                className="flex-1"
                variant="outline"
                loading={callNext.isPending}
                disabled={busy || queue.isPending || queue.isError || !canCallNext}
                aria-describedby="call-next-hint"
                onClick={() => run(async () => { await callNext.mutateAsync(); }, "تمت مناداة المريض التالي.", "current-card")}
              >
                نادي المريض التالي <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              )}
            </div>
            {!current && <p id="call-next-hint" className="mt-2 text-xs text-slate-500">
              {queue.isError || queue.isPending
                ? "الاستدعاء غير متاح حتى يُحمَّل الطابور."
                : nextList.length === 0
                ? "لا يوجد مريض في الانتظار."
                : "ينادى المريض الأول في ترتيب الطابور أدناه."}
            </p>}
            {current && !canScheduleFollowUp(current) && (
              <p id="follow-up-hint" className="mt-2 text-xs text-slate-500">
                جدولة موعد آخر تتطلب حساب مريض مرتبطًا بالحجز.
              </p>
            )}
          </section>

          {/* جدول اليوم */}
          <section className="card p-4 sm:p-5" aria-label="جدول اليوم">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">جدول اليوم</h2>
              <label className="relative block w-full sm:w-64">
                <span className="sr-only">البحث عن مريض بالاسم أو الهاتف</span>
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="البحث عن مريض"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                />
              </label>
            </div>

            {appointments.isPending ? (
              <div className="py-6"><Spinner /></div>
            ) : appointments.isError ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {apiErrorMessage(appointments.error, "تعذر تحميل مواعيد اليوم.")}{" "}
                <button type="button" className="font-semibold underline" onClick={() => void appointments.refetch()}>إعادة المحاولة</button>
              </p>
            ) : todays.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-center text-slate-600">لا توجد مواعيد اليوم.</p>
            ) : filtered.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-center text-slate-600">لا توجد نتائج مطابقة للبحث.</p>
            ) : (
              <div className="mt-3">
                <div className="hidden grid-cols-[3rem_minmax(0,1fr)_5rem_7rem_9rem] gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 md:grid" aria-hidden="true">
                  <span>الدور</span><span>المريض</span><span>الوقت</span><span>الحالة</span><span>الإجراء</span>
                </div>
                <ul>
                  {filtered.map((a, i) => {
                    const actions = appointmentActions(a, "DOCTOR");
                    const showFollowUp = a.status === "COMPLETED" && canScheduleFollowUp(a);
                    const canCall = CALL_ALLOWED.includes(a.status) && !current;
                    const canLate = LATE_ALLOWED.includes(a.status);
                    const hasMenu = canCall || canLate || actions.noShow.visible;
                    const name = beneficiaryName(a);
                    return (
                      <li
                        key={a.id}
                        className="relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-slate-100 px-1 py-3 md:grid-cols-[3rem_minmax(0,1fr)_5rem_7rem_9rem] md:px-3"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold tabular-nums text-slate-700" title="رقم الدور حسب وقت الموعد">
                          {padTurn(turns.get(a.id))}
                        </span>
                        <div className="min-w-0">
                          <p className="break-words font-bold leading-snug text-slate-900">{name}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 md:hidden">
                            <span className="tabular-nums">{a.startTime}</span>
                            <AppointmentStatusBadge status={a.status} />
                          </p>
                        </div>
                        <span className="hidden tabular-nums text-slate-700 md:block">{a.startTime}</span>
                        <span className="hidden md:block"><AppointmentStatusBadge status={a.status} /></span>

                        <div className="justify-self-end md:justify-self-start">
                          {showFollowUp ? (
                            <Button ref={registerTrigger(a.id)} variant="outline" disabled={busy} onClick={() => openFollowUp(a)} title="إنشاء موعد عودة لهذا المريض">
                              <CalendarPlus className="h-4 w-4" aria-hidden="true" /> جدولة عودة
                            </Button>
                          ) : hasMenu ? (
                            <RowActionsMenu
                              label={`إجراءات ${name}`}
                              open={menuId === a.id}
                              onOpenChange={(o) => setMenuId(o ? a.id : null)}
                              disabled={busy}
                              openUpward={i > filtered.length - 3 && filtered.length > 3}
                              triggerRef={registerTrigger(a.id)}
                              items={[
                                ...(canCall ? [{ key: "call", label: "نادِ هذا المريض", onSelect: () => run(async () => { await callPatient.mutateAsync(a.id); }, "تمت مناداة المريض.", a.id) }] : []),
                                ...(canLate ? [{ key: "late", label: "متأخر", onSelect: () => run(async () => { await markLate.mutateAsync(a.id); }, "سُجّل المريض متأخراً.", a.id) }] : []),
                                ...(actions.noShow.visible
                                  ? [{ key: "noshow", label: "لم يحضر", danger: true, disabled: !actions.noShow.enabled, hint: actions.noShow.reason, onSelect: () => openNoShow(a) }]
                                  : []),
                              ]}
                            />
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>

        {/* الدور القادم */}
        <section className="card h-fit p-4 sm:p-5" aria-label="الدور القادم">
          <h2 className="text-lg font-bold text-slate-900">الدور القادم</h2>
          {queue.isPending ? (
            <div className="py-6"><Spinner /></div>
          ) : queue.isError ? (
            <p role="alert" className="mt-3 text-sm text-red-700">تعذر تحميل ترتيب الطابور.</p>
          ) : nextList.length === 0 ? (
            <p className="mt-3 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">لا يوجد منتظرون الآن.</p>
          ) : (
            <ol className="mt-2">
              {nextList.map((a, i) => (
                <li key={a.id} className="flex items-center gap-3 border-t border-slate-100 py-3 first:border-t-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold tabular-nums text-slate-700" title="رقم الدور حسب وقت الموعد">
                    {padTurn(turns.get(a.id))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-bold leading-snug text-slate-900">{beneficiaryName(a)}</p>
                    <p className="text-xs text-slate-500">
                      {a.status === "LATE" ? "متأخر" : "في الانتظار"} · موعده <span className="tabular-nums">{a.startTime}</span>
                    </p>
                  </div>
                  <Avatar name={beneficiaryName(a)} index={i + 1} />
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-slate-500">الترتيب هنا هو ترتيب المناداة الفعلي من الخادم، وقد يختلف عن رقم الدور المرئي.</p>
        </section>
      </div>
    </div>
  );
}
