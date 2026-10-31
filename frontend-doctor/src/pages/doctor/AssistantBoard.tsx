import { AdmissionRequestCard } from "../../components/AdmissionRequestCard";
import { Modal } from "../../components/ui/Modal";
import { ArrivalPoster } from "../../components/ArrivalPoster";
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
import { Appointment, AppointmentStatus } from "../../types";
import { ASSISTANT_QUEUE_POLL_MS, QueueState } from "../../hooks/useQueue";
import { admissionCandidate, callSignatures, newlyCalled } from "../../lib/assistantCalls";
import { RELATIONSHIP_LABELS } from "../../lib/features";
import { beneficiaryName, padTurn, visibleTurnNumbers } from "../../lib/appointmentPeople";
import { appointmentActions } from "../../lib/doctorUi";
import { NoShowSmsDialog, NoShowTarget } from "../../components/NoShowSmsDialog";
import { WalkInPanel, WALK_IN_NOTE } from "../../components/WalkInPanel";
import { canSendAttendanceMessage, canMarkLate, canMarkUnanswered, callAge, callTime, filterReception, orderReception, receptionConnection, receptionLabel, receptionTime, RECEPTION_STATUSES } from "../../lib/assistantReception";

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
  const [dismissedRequests, setDismissedRequests] = useState<string[]>([]);
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
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<Map<string, string | null>>(new Map());
  const queues = useQuery({ queryKey: ["assistant-queues", user?.id], queryFn: async () => (await api.get<{ data: DoctorQueue[] }>("/assistant/queues")).data.data, retry: false, refetchInterval: livePollInterval(live, ASSISTANT_QUEUE_POLL_MS), refetchIntervalInBackground: false, refetchOnWindowFocus: true });
  const appointments = useQuery({ queryKey: ["assistant-appointments", user?.id, appointmentDate], queryFn: async () => (await api.get<{ data: BoardAppointment[] }>("/assistant/appointments", { params: { date: appointmentDate } })).data.data, retry: false, refetchInterval: livePollInterval(live, 15000), refetchIntervalInBackground: false });
  // المدخول اليومي: للصفحة الرئيسية فقط، إجمالي اليوم لأطباء المساعد المرتبطين (لا نسب ولا أسعار أطباء).
  const income = useQuery({ queryKey: ["assistant-daily-income", user?.id], enabled: !appointmentsView, queryFn: async () => (await api.get<{ data: { totalDzd: number; completedCount: number } }>("/assistant/daily-income")).data.data, retry: false, refetchInterval: livePollInterval(live, 30000), refetchIntervalInBackground: false, refetchOnWindowFocus: true });
  useEffect(() => {
    if (!queues.data) return;
    const rows = queues.data.map(row => ({ doctorId: row.doctor.id, current: admissionCandidate(row.queue, today) }));
    const activeKeys = queues.data.filter(row => row.queue.awaitingAssistant && !row.queue.current).map(row => `${row.doctor.id}:${admissionCandidate(row.queue, today)?.id ?? "waiting"}`);
    setDismissedRequests(keys => keys.filter(key => activeKeys.includes(key)));
    const calls = newlyCalled(rows, previous.current);
    if (calls.length) showToast(t("نداء جديد: {0}", { "0": calls.map(call => {
      const doctor = queues.data.find(row => row.doctor.id === call.doctorId)!.doctor;
      return `${patientName(call.current!)} — ${doctorName(doctor)}`;
    }).join(t("؛ ")) }), "info");
    if (calls.length && sound) chime(audio.current);
    previous.current = callSignatures(rows);
  }, [queues.data, sound, showToast, today]);
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
    onError: error => { showToast(apiErrorMessage(error), "error"); void qc.invalidateQueries({ queryKey: ["assistant-queues"] }); void qc.invalidateQueries({ queryKey: ["assistant-appointments"] }); },
  });
  function update(appointment: Appointment, kind: "arrived" | "late" | "call" | "urgency" | AppointmentStatus) {
    if (action.isPending) return;
    if ((kind === "CANCELLED" || kind === "NO_SHOW") && !window.confirm(kind === "CANCELLED" ? t("هل تريد إلغاء هذا الموعد؟") : t("هل تريد تسجيل عدم حضور هذا المريض؟"))) return;
    action.mutate({ appointment, kind });
  }
  function actions(a: Appointment) {
    if (a.status === "IN_PROGRESS") return <p className="text-sm text-green-800">{t("المريض عند الطبيب — انتظر انتهاء الكشف")}</p>;
    const rules = appointmentActions(a, "ASSISTANT");
    const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
    const openDialog = (mode: "call" | "final") => {
      const d = queues.data?.find(row => row.doctor.id === a.doctorId)?.doctor;
      setDialog({ appointment: a, mode, target: { id: a.id, patientName: patientName(a), doctorName: d ? `${d.firstName} ${d.lastName}` : undefined, phone: a.patient?.user?.phone ?? a.guestPhone, date: a.date, startTime: a.startTime, alreadyNoShow: a.status === "NO_SHOW" } });
    };
    return <div className="flex flex-wrap gap-2 [&_button]:min-h-11">
      {a.status === "PENDING" && <Button variant="outline" disabled={action.isPending} onClick={() => update(a, "CONFIRMED")}>{t("تأكيد")}</Button>}
      {(a.status === "CONFIRMED" || a.status === "LATE") && !a.arrivedAt && a.date.slice(0, 10) === today && <Button variant="outline" disabled={action.isPending || !canManageAttendance} onClick={() => update(a, "arrived")}>{t("وصل المريض")}</Button>}
      {a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE") && queues.data?.some(row => row.doctor.id === a.doctorId && row.queue.awaitingAssistant && !row.queue.current) && <Button title={t("يُستدعى أول مريض حاضر حسب ترتيب الطابور.")} disabled={action.isPending || !canManageAttendance || queues.isError || !queues.data?.some(row => row.doctor.id === a.doctorId && admissionCandidate(row.queue, today)?.id === a.id)} onClick={() => update(a, "call")}>{t("إدخال المريض")}</Button>}
      {a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE") && (!a.urgencyStatus || a.urgencyStatus === "NONE") && <Button variant="outline" disabled={!canManageAttendance || action.isPending} onClick={() => update(a, "urgency")}>{t("طلب تقديم حالة مستعجلة")}</Button>}
      {a.urgencyStatus === "REQUESTED" && <span className="text-xs text-amber-700">{t("بانتظار قرار الطبيب")}</span>}
      {a.urgencyStatus === "APPROVED" && <span className="text-xs text-red-700">{t("حالة مستعجلة معتمدة")}</span>}
      {canMarkLate(a, today) && <Button variant="outline" disabled={action.isPending} onClick={() => update(a, "late")}>{t("متأخر")}</Button>}
      {canSendAttendanceMessage(a) && <Button variant="ghost" disabled={action.isPending} onClick={() => openDialog("call")}>{t("إرسال رسالة")}</Button>}
      {rules.note && <p className="text-xs text-slate-600">{rules.note}</p>}
      {(a.status === "PENDING" || a.status === "CONFIRMED") && <Button variant="ghost" disabled={action.isPending} onClick={() => update(a, "CANCELLED")}>{t("إلغاء الموعد")}</Button>}
    </div>;
  }
  const admit = useMutation({
    mutationFn: async (appointment: Appointment) => api.post(`/appointments/${appointment.id}/call`, {}, { headers: { "X-Assistant-Doctor-Id": appointment.doctorId } }),
    onSuccess: (_data, appointment) => {
      setDismissedRequests(keys => [...keys, `${appointment.doctorId}:${appointment.id}`]);
      showToast(t("تم إدخال المريض عند الطبيب."), "success");
      void qc.invalidateQueries({ queryKey: ["assistant-queues"] });
      void qc.invalidateQueries({ queryKey: ["assistant-appointments"] });
    },
    onError: error => {
      showToast(apiErrorMessage(error), "error");
      void qc.invalidateQueries({ queryKey: ["assistant-queues"] });
      void qc.invalidateQueries({ queryKey: ["assistant-appointments"] });
    },
  });
  if (queues.isPending) return <Spinner />;
  const doctorQueues = queues.data ?? [];
  const requests = doctorQueues.filter(({ queue }) => queue.date.slice(0, 10) === today && queue.awaitingAssistant && !queue.current).map(({ doctor, queue }) => {
    const candidate = admissionCandidate(queue, today);
    return { doctor, candidate, key: `${doctor.id}:${candidate?.id ?? "waiting"}` };
  });
  const openRequests = requests.filter(request => !dismissedRequests.includes(request.key));
  const requestCard = ({ doctor, candidate, key }: typeof requests[number]) => {
    const doctorAppointments = (appointments.data ?? []).filter(a => a.doctorId === doctor.id && a.status !== "CANCELLED");
    const turn = appointments.isSuccess && !appointments.isError && candidate ? padTurn(visibleTurnNumbers(doctorAppointments).get(candidate.id)) : undefined;
    return <AdmissionRequestCard key={key} doctorName={doctorName(doctor)} patientName={candidate ? patientName(candidate) : undefined} turn={turn}>
      {candidate && <Button className="min-h-12 w-full" loading={admit.isPending && admit.variables?.id === candidate.id} disabled={admit.isPending || action.isPending || !canManageAttendance || queues.isError} onClick={() => { if (!admit.isPending) admit.mutate(candidate); }}>{t("إدخال المريض")}</Button>}
    </AdmissionRequestCard>;
  };
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
      <div><span className={`inline-block rounded-lg px-2 py-1 text-xs font-semibold ${a.status === "IN_PROGRESS" || a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE") ? "bg-green-100 text-green-900" : "bg-slate-100 text-slate-800"}`}>{a.status === "IN_PROGRESS" ? t("عند الطبيب") : receptionLabel(a)}</span>{a.status === "IN_PROGRESS" && a.calledAt && <span className="mt-1 block text-xs text-slate-700"><bdi dir="ltr">{callTime(a.calledAt)}</bdi> — {callAge(a.calledAt, now)}</span>}{a.notes?.startsWith(WALK_IN_NOTE) && <span className="mt-1 block text-xs text-slate-600">{t("حضر بدون موعد")}</span>}</div>
      <div className="col-span-2 lg:col-span-1">{actions(a)}</div>
    </li>)}
  </ol>;
  return <div className="space-y-3">
    <NoShowSmsDialog target={dialog?.target ?? null} mode={dialog?.mode} onClose={() => setDialog(null)} />
    <Modal open={!appointmentsView && openRequests.length > 0 && !dialog} onClose={() => { if (!admit.isPending) setDismissedRequests(keys => [...keys, ...openRequests.map(r => r.key)]); }} title={t("طلب إدخال مريض")}>
      <div className="space-y-3">
        {openRequests.map(requestCard)}
        <p className="text-xs text-slate-600">{t("اضغط إدخال المريض بعد دخوله فعليًا. إغلاق النافذة لا يسجّل دخوله.")}</p>
        {admit.isError && <p role="alert" className="text-sm text-red-700">{apiErrorMessage(admit.error)}</p>}
      </div>
    </Modal>
    {!appointmentsView && requests.length > 0 && <section aria-label={t("طلبات إدخال المرضى ({0})", { "0": requests.length })} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-primary-900">{t("طلبات إدخال المرضى ({0})", { "0": requests.length })}</h2>
        <Button variant="outline" onClick={() => { admit.reset(); setDismissedRequests([]); }}>{t("عرض التفاصيل")}</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{requests.map(requestCard)}</div>
      {admit.isError && <p role="alert" className="text-sm text-red-700">{apiErrorMessage(admit.error)}</p>}
    </section>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold">{appointmentsView ? t("مواعيد الأطباء") : t("طابور اليوم")}</h1>
      {!appointmentsView && <WalkInPanel doctors={doctorQueues.map(row => row.doctor)} />}
    </div>
    <div className="flex flex-wrap items-start gap-2">
      <ArrivalPoster />
      <Button variant="outline" aria-pressed={sound} className="min-h-11 text-sm" onClick={() => {
        if (!sound) { try { audio.current ??= new AudioContext(); chime(audio.current); } catch { showToast(t("المتصفح لا يدعم التنبيه الصوتي."), "error"); return; } }
        setSound(value => !value);
      }}>{sound ? <Bell /> : <BellOff />}{sound ? t("إيقاف الصوت") : t("تفعيل صوت النداء")}</Button>
    </div>
    {queues.isSuccess && !doctorQueues.length && <p className="card p-5">{t("لا يوجد أطباء مرتبطون بك حاليًا. تواصل مع مالك العيادة.")}</p>}
    {!appointmentsView && <details className="card px-3 py-2 text-sm text-slate-700">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2">
        <span>{t("المدخول اليومي ")}</span><strong className="text-lg text-slate-900">{income.isSuccess ? <><bdi dir="ltr" className="tabular-nums">{income.data.totalDzd.toLocaleString("en-US")}</bdi>{t(" دج")}</> : income.isError ? "—" : "…"}</strong>
      </summary>
      <p className="pb-2 text-xs">{income.isSuccess ? t("{0} كشف مكتمل اليوم", { "0": income.data.completedCount }) : income.isError ? t("تعذّر تحميل المدخول.") : t("جارٍ التحميل")}</p>
    </details>}
    {!appointmentsView && doctorQueues.length > 1 && <label className="block text-sm font-semibold">{t("الطبيب")}<select className="input mt-1 min-h-11 w-full" value={filter.doctorId} onChange={e => setFilter(f => ({ ...f, doctorId: e.target.value }))}><option value="">{t("كل الأطباء")}</option>{doctorQueues.map(({ doctor }) => <option key={doctor.id} value={doctor.id}>{doctorName(doctor)}</option>)}</select></label>}
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
      {appointmentsView && <h2 className="text-lg font-bold">{t("المواعيد")}</h2>}
      {appointments.isPending ? <Spinner /> : <>
        {appointments.isError ? <p role="alert" className="card p-4">{t("تعذر تحميل المواعيد. أعد المحاولة.")}</p> : !visible.length ? <p className="card p-5">{filter.doctorId || filter.status || filter.search ? t("لا توجد مواعيد تطابق المرشحات في هذا اليوم.") : t("لا يوجد مرضى في القائمة لهذا اليوم.")}</p> : <>
          {visible.length > 0 && rows(visible)}
        </>}
      </>}
    </section>
    <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-slate-700"><span>{connected}</span>{!connected.startsWith(t("متصل")) && <Button variant="outline" disabled={queues.isFetching || appointments.isFetching} onClick={() => { void queues.refetch(); void appointments.refetch(); }}>{t("إعادة المحاولة")}</Button>}</div>
  </div>;
}
