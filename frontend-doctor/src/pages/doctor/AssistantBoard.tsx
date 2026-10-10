import { useAttendanceActions } from "../../hooks/useAttendanceActions";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useLiveUpdates } from "../../context/LiveUpdatesContext";
import { livePollInterval } from "../../lib/livePolling";
import { useToast } from "../../components/ui/Toast";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { Modal } from "../../components/ui/Modal";
import { Appointment, AppointmentStatus } from "../../types";
import { ASSISTANT_QUEUE_POLL_MS, QueueState } from "../../hooks/useQueue";
import { callSignatures, newlyCalled } from "../../lib/assistantCalls";
import { RELATIONSHIP_LABELS } from "../../lib/features";
import { beneficiaryName } from "../../lib/appointmentPeople";
import { appointmentActions } from "../../lib/doctorUi";
import { NoShowSmsDialog, NoShowTarget } from "../../components/NoShowSmsDialog";
import { WalkInPanel, WALK_IN_NOTE } from "../../components/WalkInPanel";
import { canSendAttendanceMessage, canMarkLate, canMarkUnanswered, callAge, callTime, filterReception, orderReception, receptionConnection, receptionLabel, receptionTime, RECEPTION_STATUSES } from "../../lib/assistantReception";
import { advanceAfterMissedCall } from "../../lib/assistantAdvance";

type DoctorQueue = { doctor: { id: string; firstName: string; lastName: string }; queue: QueueState };
type BoardAppointment = Appointment & { doctor: DoctorQueue["doctor"] };
function patientName(a: Appointment) {
  const relationship = a.beneficiary?.relationship ?? a.familyMember?.relationship;
  return `${beneficiaryName(a)}${relationship ? ` (${RELATIONSHIP_LABELS[relationship]})` : ""}`;
}
function doctorName(d: DoctorQueue["doctor"]) { return t("د. {0} {1}", { "0": d.firstName, "1": d.lastName }); }
function chime(context: AudioContext | null) {
  if (!context) return;
  void context.resume().then(() => {
    [880, 1175].forEach((frequency, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * 0.25;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start); oscillator.stop(start + 0.24);
    });
  }).catch(() => undefined);
}

export default function AssistantBoard({ appointmentsView = false }: { appointmentsView?: boolean }) {
  useLanguage();
  const live = useLiveUpdates();
  const { user } = useAuth();
  const canManageAttendance = useAttendanceActions();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date(Date.now() + 3600000).toISOString().slice(0, 10));
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const appointmentDate = appointmentsView ? date : today;
  const [sound, setSound] = useState(false);
  const [filter, setFilter] = useState({ doctorId: "", status: "", search: "" });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: number | undefined;
    const updateVisibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), 1000);
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);
  const [dialog, setDialog] = useState<{ appointment: Appointment; target: NoShowTarget; mode: "call" | "final" } | null>(null);
  const [missedCall, setMissedCall] = useState<Appointment | null>(null);
  const [advanceRetries, setAdvanceRetries] = useState<Record<string, Appointment>>({});
  const advancing = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<Map<string, string | null>>(new Map());
  const queues = useQuery({ queryKey: ["assistant-queues", user?.id], queryFn: async () => (await api.get<{ data: DoctorQueue[] }>("/assistant/queues")).data.data, retry: false, refetchInterval: livePollInterval(live, ASSISTANT_QUEUE_POLL_MS), refetchIntervalInBackground: false, refetchOnWindowFocus: true });
  const appointments = useQuery({ queryKey: ["assistant-appointments", user?.id, appointmentDate], queryFn: async () => (await api.get<{ data: BoardAppointment[] }>("/assistant/appointments", { params: { date: appointmentDate } })).data.data, retry: false, refetchInterval: livePollInterval(live, 15000), refetchIntervalInBackground: false });
  // المدخول اليومي: للصفحة الرئيسية فقط، إجمالي اليوم لأطباء المساعد المرتبطين (لا نسب ولا أسعار أطباء).
  const income = useQuery({ queryKey: ["assistant-daily-income", user?.id], enabled: !appointmentsView, queryFn: async () => (await api.get<{ data: { totalDzd: number; completedCount: number } }>("/assistant/daily-income")).data.data, retry: false, refetchInterval: livePollInterval(live, 30000), refetchIntervalInBackground: false, refetchOnWindowFocus: true });
  useEffect(() => {
    if (!queues.data) return;
    const rows = queues.data.map(row => ({ doctorId: row.doctor.id, current: row.queue.current }));
    const calls = newlyCalled(rows, previous.current);
    if (calls.length) showToast(t("نداء جديد: {0}", { "0": calls.map(call => {
      const doctor = queues.data.find(row => row.doctor.id === call.doctorId)!.doctor;
      return `${patientName(call.current!)} — ${doctorName(doctor)}`;
    }).join(t("؛ ")) }), "info");
    if (calls.length && sound) chime(audio.current);
    previous.current = callSignatures(rows);
  }, [queues.data, sound, showToast]);
  useEffect(() => () => { void audio.current?.close().catch(() => undefined); }, []);
  const action = useMutation({
    mutationFn: async ({ appointment, kind }: { appointment: Appointment; kind: "arrived" | "late" | "call" | "urgency" | AppointmentStatus }) => {
      // The row owns its doctor context. No global doctor selection or shared mutable header.
      const config = { headers: { "X-Assistant-Doctor-Id": appointment.doctorId } };
      if (kind === "urgency") {
        const reason = window.prompt(t("سبب طلب تقديم الحالة المستعجلة"));
        if (!reason?.trim()) return;
        return api.post(`/appointments/${appointment.id}/urgency`, { reason: reason.trim() }, config);
      }
      return kind === "arrived" || kind === "late" || kind === "call"
        ? api.post(`/appointments/${appointment.id}/${kind}`, {}, config)
        : api.patch(`/appointments/${appointment.id}`, { status: kind }, config);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["assistant-queues"] }); void qc.invalidateQueries({ queryKey: ["assistant-appointments"] }); void qc.invalidateQueries({ queryKey: ["assistant-daily-income"] }); },
    onError: error => showToast(apiErrorMessage(error), "error"),
  });
  function update(appointment: Appointment, kind: "arrived" | "late" | "call" | "urgency" | AppointmentStatus) {
    if (advancing.current || action.isPending) return;
    if ((kind === "CANCELLED" || kind === "NO_SHOW") && !window.confirm(kind === "CANCELLED" ? t("هل تريد إلغاء هذا الموعد؟") : t("هل تريد تسجيل عدم حضور هذا المريض؟"))) return;
    action.mutate({ appointment, kind });
  }
  const advance = useMutation({
    mutationFn: async ({ appointment, retry = false }: { appointment: Appointment; retry?: boolean }) => {
      const config = { headers: { "X-Assistant-Doctor-Id": appointment.doctorId } };
      return advanceAfterMissedCall(appointment.id, {
        defer: () => api.post(`/appointments/${appointment.id}/late`, {}, config),
        queue: async () => (await api.get<{ data: QueueState }>("/appointments/queue", config)).data.data,
        call: async id => (await api.post<{ data: Appointment }>(`/appointments/${id}/call`, {}, config)).data.data,
      }, retry);
    },
    onSuccess: (result, { appointment }) => {
      setMissedCall(null);
      setAdvanceRetries(previous => {
        const next = { ...previous };
        if (result.kind === "retry") next[appointment.doctorId] = appointment;
        else delete next[appointment.doctorId];
        return next;
      });
      if (result.kind === "retry") showToast(t("أُجّل الموعد دون حذفه، لكن تعذّر نداء التالي: {0}", { "0": apiErrorMessage(result.error) }), "error");
      else if (result.kind === "empty") showToast(t("أُجّل الموعد دون حذفه. لا يوجد مريض آخر في الطابور."), "info");
      else showToast(t("{0} {1}. الموعد السابق باقٍ دون حذف.", { "0": result.kind === "called" ? t("نودي على") : t("يوجد نداء حالي لـ"), "1": patientName(result.appointment) }), "success");
    },
    onError: error => showToast(apiErrorMessage(error, t("تعذّر تأجيل الموعد؛ لم يتم نداء التالي.")), "error"),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["assistant-queues"] }); void qc.invalidateQueries({ queryKey: ["assistant-appointments"] }); },
  });
  async function deferAndAdvance(appointment: Appointment, retry = false) {
    if (advancing.current || action.isPending) return;
    advancing.current = true;
    try { await advance.mutateAsync({ appointment, retry }); } catch { /* mutation displays the error */ }
    finally { advancing.current = false; }
  }
  function actions(a: Appointment) {
    const rules = appointmentActions(a, "ASSISTANT");
    const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
    const openDialog = (mode: "call" | "final") => {
      const d = queues.data?.find(row => row.doctor.id === a.doctorId)?.doctor;
      setDialog({ appointment: a, mode, target: { id: a.id, patientName: patientName(a), doctorName: d ? `${d.firstName} ${d.lastName}` : undefined, phone: a.patient?.user?.phone ?? a.guestPhone, date: a.date, startTime: a.startTime, alreadyNoShow: a.status === "NO_SHOW" } });
    };
    return <div className="flex flex-wrap gap-2 [&_button]:min-h-11">
      {a.status === "PENDING" && <Button variant="outline" disabled={action.isPending || advance.isPending} onClick={() => update(a, "CONFIRMED")}>{t("تأكيد")}</Button>}
      {(a.status === "CONFIRMED" || a.status === "LATE") && !a.arrivedAt && a.date.slice(0, 10) === today && <Button variant="outline" disabled={action.isPending || advance.isPending || !canManageAttendance} onClick={() => update(a, "arrived")}>{t("وصل المريض")}</Button>}
      {a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE") && queues.data?.some(row => row.doctor.id === a.doctorId && row.queue.awaitingAssistant && !row.queue.current) && <Button disabled={action.isPending || !canManageAttendance} onClick={() => update(a, "call")}>{t("تأكيد الإدخال")}</Button>}
      {a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE") && (!a.urgencyStatus || a.urgencyStatus === "NONE") && <Button variant="outline" disabled={!canManageAttendance || action.isPending} onClick={() => update(a, "urgency")}>{t("طلب تقديم حالة مستعجلة")}</Button>}
      {a.urgencyStatus === "REQUESTED" && <span className="text-xs text-amber-700">{t("بانتظار قرار الطبيب")}</span>}
      {a.urgencyStatus === "APPROVED" && <span className="text-xs text-red-700">{t("حالة مستعجلة معتمدة")}</span>}
      {canMarkUnanswered(a) && <Button variant="outline" disabled={action.isPending || advance.isPending} onClick={() => setMissedCall(a)}>{t("تأجيل ونداء التالي")}</Button>}
      {canMarkLate(a, today) && <Button variant="outline" disabled={action.isPending || advance.isPending} onClick={() => update(a, "late")}>{t("متأخر")}</Button>}
      {canSendAttendanceMessage(a) && <Button variant="ghost" disabled={action.isPending || advance.isPending} onClick={() => openDialog("call")}>{t("إرسال رسالة")}</Button>}
      {rules.note && <p className="text-xs text-slate-600">{rules.note}</p>}
      {(a.status === "PENDING" || a.status === "CONFIRMED") && <Button variant="ghost" disabled={action.isPending || advance.isPending} onClick={() => update(a, "CANCELLED")}>{t("إلغاء الموعد")}</Button>}
    </div>;
  }
  if (queues.isPending) return <Spinner />;
  const doctorQueues = queues.data ?? [];
  // Use the faster queue response for today's current/waiting rows, keeping the
  // full daily list (including pending/completed appointments) from its own API.
  const liveAppointments = new Map(doctorQueues.filter(row => row.queue.date.slice(0, 10) === appointmentDate).flatMap(({ queue }) => [
    ...(queue.current ? [queue.current] : []), ...queue.waiting, ...queue.late,
  ]).map(appointment => [appointment.id, appointment]));
  const merged = (appointments.data ?? []).map(appointment => ({ ...appointment, ...(liveAppointments.get(appointment.id) ?? {}), doctor: appointment.doctor }));
  const list = filterReception(orderReception(merged, doctorQueues.map(({ doctor, queue }) => ({ id: doctor.id, order: (queue.ordered ?? [...queue.waiting, ...queue.late]).map(a => a.id) }))), filter, patientName);
  const completed = list.filter(a => a.status === "COMPLETED");
  const visible = appointmentsView ? list : list.filter(a => a.status !== "COMPLETED");
  const connected = receptionConnection(queues.dataUpdatedAt, appointments.dataUpdatedAt, queues.isError || appointments.isError, now);
  const rows = (items: BoardAppointment[]) => <ol className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
    {items.map(a => <li key={a.id} className={`grid grid-cols-2 items-center gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-[5rem_1.3fr_1fr_11rem_1.5fr] ${a.status === "IN_PROGRESS" ? "bg-green-50/50" : ""}`}>
      <span dir="ltr" className="text-start text-sm tabular-nums">{receptionTime(a.startTime)}</span>
      <span className="break-words font-semibold">{patientName(a)}</span>
      <span className="text-sm text-slate-700">{doctorName(a.doctor)}</span>
      <div><span className={`inline-block rounded-lg px-2 py-1 text-xs font-semibold ${a.status === "IN_PROGRESS" || a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE") ? "bg-green-100 text-green-900" : "bg-slate-100 text-slate-800"}`}>{receptionLabel(a)}</span>{a.status === "IN_PROGRESS" && a.calledAt && <span className="mt-1 block text-xs text-slate-700"><bdi dir="ltr">{callTime(a.calledAt)}</bdi> — {callAge(a.calledAt, now)}</span>}{a.notes?.startsWith(WALK_IN_NOTE) && <span className="mt-1 block text-xs text-slate-600">{t("حضر بدون موعد")}</span>}</div>
      <div className="col-span-2 lg:col-span-1">{actions(a)}</div>
    </li>)}
  </ol>;
  return <div className="space-y-5">
    <Modal open={Boolean(missedCall)} onClose={() => { if (!advancing.current) setMissedCall(null); }} title={t("تجاوز النداء دون حذف الموعد")} footer={<Button loading={advance.isPending} onClick={() => { if (missedCall) void deferAndAdvance(missedCall); }}>{t("تأجيل المريض ونداء التالي")}</Button>}>
      <p className="text-slate-800">{missedCall && patientName(missedCall)}{t(" لم يستجب للنداء. يبقى موعده في قائمة المتأخرين وفق ترتيب الطابور الحالي، ويُنادى المريض التالي لدى الطبيب نفسه.")}</p>
      <p className="mt-3 text-sm text-slate-700">{t("استخدم هذا الإجراء فقط إن لم يبدأ المريض الكشف. لن يُسجَّل غياب نهائي ولن تُفتح الرسائل.")}</p>
    </Modal>
    {Object.values(advanceRetries).map(appointment => <div key={appointment.doctorId} role="alert" className="card p-4 text-slate-800"><p>{t("تم تأجيل ")}{patientName(appointment)}{t(" دون حذف موعده، لكن نداء التالي لم يتأكد.")}</p><Button className="mt-2 min-h-11" loading={advance.isPending} onClick={() => void deferAndAdvance(appointment, true)}>{t("إعادة محاولة نداء التالي")}</Button></div>)}
    <NoShowSmsDialog target={dialog?.target ?? null} mode={dialog?.mode} onClose={() => setDialog(null)} />
    {doctorQueues.filter(row => row.queue.awaitingAssistant && !row.queue.current).map(row => <p key={row.doctor.id} role="status" className="rounded-xl bg-amber-50 p-3">{row.doctor.firstName} {row.doctor.lastName}: {t("في انتظار تأكيد المساعد")}</p>)}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{appointmentsView ? t("مواعيد الأطباء") : t("الطابور")}</h1><p className="mt-1 text-sm text-slate-600">{t("المواعيد والنداءات في قائمة واحدة، دون تكرار المريض.")}</p></div>
      <Button variant="outline" onClick={() => {
        if (!sound) { try { audio.current ??= new AudioContext(); chime(audio.current); } catch { showToast(t("المتصفح لا يدعم التنبيه الصوتي."), "error"); return; } }
        setSound(value => !value);
      }}>{sound ? <Bell /> : <BellOff />}{sound ? t("إيقاف الصوت") : t("تفعيل صوت النداء")}</Button>
    </div>
    {queues.isSuccess && !doctorQueues.length && <p className="card p-5">{t("لا يوجد أطباء مرتبطون بك حاليًا. تواصل مع مالك العيادة.")}</p>}
    {!appointmentsView && <section className="flex flex-wrap items-center justify-between gap-3" aria-label={t("المدخول اليومي وإضافة مريض")}>
      <p className="card min-w-[14rem] flex-1 p-4 text-sm text-slate-700">{t("المدخول اليومي ")}<strong className="mt-1 block text-2xl text-slate-900">{income.isSuccess ? <><bdi dir="ltr" className="tabular-nums">{income.data.totalDzd.toLocaleString("en-US")}</bdi>{t(" دج")}</> : income.isError ? "—" : "…"}</strong>
        <span className="text-xs text-slate-600">{income.isSuccess ? t("{0} كشف مكتمل اليوم", { "0": income.data.completedCount }) : income.isError ? t("تعذّر تحميل المدخول.") : t("جارٍ التحميل")}</span>
      </p>
      <WalkInPanel doctors={doctorQueues.map(row => row.doctor)} />
    </section>}
    {appointmentsView && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t("أعداد النتائج بعد التصفية")}>
      {[[t("النتائج"), list.length], [t("وصل — ينتظر"), list.filter(a => a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE")).length], [t("تم نداؤه"), list.filter(canMarkUnanswered).length], [t("مكتمل"), completed.length]].map(([label, count]) => <p key={label} className="card p-3 text-sm text-slate-700">{t(label ?? "")}<strong className="mt-1 block text-xl text-slate-900">{count}</strong></p>)}
    </div>}
    {appointmentsView && <section className="card grid gap-3 p-4 sm:grid-cols-3" aria-label={t("مرشحات الطابور")}>
      {appointmentsView && <label className="text-sm font-semibold text-slate-700">{t("تاريخ المواعيد")}<input className="input mt-1 block min-h-11 w-full" dir="ltr" type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label>}
      <label className="text-sm font-semibold text-slate-700">{t("الطبيب")}<select className="input mt-1 min-h-11 w-full" value={filter.doctorId} onChange={e => setFilter(f => ({ ...f, doctorId: e.target.value }))}><option value="">{t("كل الأطباء")}</option>{doctorQueues.map(({ doctor }) => <option key={doctor.id} value={doctor.id}>{doctorName(doctor)}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">{t("الحالة")}<select className="input mt-1 min-h-11 w-full" value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}><option value="">{t("كل الحالات")}</option><option value="ARRIVED">{t("وصل — ينتظر")}</option>{Object.entries(RECEPTION_STATUSES).map(([status, label]) => <option key={status} value={status}>{t(label ?? "")}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">{t("البحث باسم المريض")}<input type="search" className="input mt-1 min-h-11 w-full" value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} placeholder={t("اكتب الاسم")} /></label>
      {(filter.doctorId || filter.status || filter.search) && <Button variant="ghost" onClick={() => setFilter({ doctorId: "", status: "", search: "" })}>{t("مسح المرشحات")}</Button>}
    </section>}
    <section aria-label={t("قائمة المواعيد الموحدة")} className="space-y-3">
      <h2 className="text-lg font-bold">{appointmentsView ? t("المواعيد") : t("مواعيد اليوم والطابور")}</h2>
      <p className="text-sm text-slate-700">{t("مرتبة وفق طابور كل طبيب. النداء لا يؤكد بدء الكشف.")}</p>
      {appointments.isPending ? <Spinner /> : <>
        {!list.length ? <p className="card p-5">{t("لا توجد مواعيد تطابق المرشحات في هذا اليوم.")}</p> : <>
          {visible.length > 0 && rows(visible)}
        </>}
      </>}
    </section>
    <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-slate-700"><span>{connected}</span>{!connected.startsWith(t("متصل")) && <Button variant="outline" disabled={queues.isFetching || appointments.isFetching} onClick={() => { void queues.refetch(); void appointments.refetch(); }}>{t("إعادة المحاولة")}</Button>}</div>
  </div>;
}
