import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Megaphone } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { Appointment, AppointmentStatus } from "../../types";
import { ASSISTANT_QUEUE_POLL_MS, QueueState } from "../../hooks/useQueue";
import { callSignatures, newlyCalled } from "../../lib/assistantCalls";
import { RELATIONSHIP_LABELS } from "../../lib/features";
import { appointmentActions } from "../../lib/doctorUi";
import { NoShowSmsDialog, NoShowTarget } from "../../components/NoShowSmsDialog";

type DoctorQueue = { doctor: { id: string; firstName: string; lastName: string }; queue: QueueState };
type BoardAppointment = Appointment & { doctor: DoctorQueue["doctor"] };
function patientName(a: Appointment) {
  if (a.familyMember) return `${a.familyMember.firstName} ${a.familyMember.lastName} (${RELATIONSHIP_LABELS[a.familyMember.relationship]})`;
  return a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ") || "مريض بدون اسم";
}
function doctorName(d: DoctorQueue["doctor"]) { return `د. ${d.firstName} ${d.lastName}`; }
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
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date(Date.now() + 3600000).toISOString().slice(0, 10));
  const [sound, setSound] = useState(false);
  const [dialog, setDialog] = useState<{ appointment: Appointment; target: NoShowTarget; mode: "call" | "final" } | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<Map<string, string | null>>(new Map());
  const queues = useQuery({ queryKey: ["assistant-queues", user?.id], queryFn: async () => (await api.get<{ data: DoctorQueue[] }>("/assistant/queues")).data.data, refetchInterval: ASSISTANT_QUEUE_POLL_MS, refetchIntervalInBackground: false, refetchOnWindowFocus: true });
  const appointments = useQuery({ queryKey: ["assistant-appointments", user?.id, date], enabled: appointmentsView, queryFn: async () => (await api.get<{ data: BoardAppointment[] }>("/assistant/appointments", { params: { date } })).data.data, refetchInterval: 15000, refetchIntervalInBackground: false });
  useEffect(() => {
    if (!queues.data) return;
    const rows = queues.data.map(row => ({ doctorId: row.doctor.id, current: row.queue.current }));
    const calls = newlyCalled(rows, previous.current);
    if (calls.length && sound) chime(audio.current);
    previous.current = callSignatures(rows);
  }, [queues.data, sound]);
  useEffect(() => () => { void audio.current?.close().catch(() => undefined); }, []);
  const action = useMutation({
    mutationFn: async ({ appointment, kind }: { appointment: Appointment; kind: "arrived" | "late" | AppointmentStatus }) => {
      // The row owns its doctor context. No global doctor selection or shared mutable header.
      const config = { headers: { "X-Assistant-Doctor-Id": appointment.doctorId } };
      return kind === "arrived" || kind === "late"
        ? api.post(`/appointments/${appointment.id}/${kind}`, {}, config)
        : api.patch(`/appointments/${appointment.id}`, { status: kind }, config);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["assistant-queues"] }); void qc.invalidateQueries({ queryKey: ["assistant-appointments"] }); },
    onError: error => showToast(apiErrorMessage(error), "error"),
  });
  function update(appointment: Appointment, kind: "arrived" | "late" | AppointmentStatus) {
    if ((kind === "CANCELLED" || kind === "NO_SHOW") && !window.confirm(kind === "CANCELLED" ? "هل تريد إلغاء هذا الموعد؟" : "هل تريد تسجيل عدم حضور هذا المريض؟")) return;
    action.mutate({ appointment, kind });
  }
  function actions(a: Appointment) {
    const rules = appointmentActions(a, "ASSISTANT");
    const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
    const openDialog = (mode: "call" | "final") => {
      const d = queues.data?.find(row => row.doctor.id === a.doctorId)?.doctor;
      setDialog({ appointment: a, mode, target: { id: a.id, patientName: patientName(a), doctorName: d ? `${d.firstName} ${d.lastName}` : undefined, phone: a.patient?.user?.phone ?? a.guestPhone, date: a.date, startTime: a.startTime, alreadyNoShow: a.status === "NO_SHOW" } });
    };
    return <div className="flex flex-wrap gap-2">
      {a.status === "PENDING" && <Button variant="outline" disabled={action.isPending} onClick={() => update(a, "CONFIRMED")}>تأكيد</Button>}
      {(a.status === "CONFIRMED" || a.status === "LATE") && !a.arrivedAt && a.date.slice(0, 10) === today && <Button variant="outline" disabled={action.isPending} onClick={() => update(a, "arrived")}>وصل المريض</Button>}
      {a.status === "IN_PROGRESS" && <Button variant="outline" disabled={action.isPending} onClick={() => openDialog("call")}>لم يستجب للنداء</Button>}
      {appointmentsView && rules.noShow.visible && <Button variant="ghost" disabled={action.isPending || !rules.noShow.enabled} title={rules.noShow.reason} onClick={() => openDialog("final")}>لم يحضر</Button>}
      {rules.note && <p className="text-xs text-slate-500">{rules.note}</p>}
      {(a.status === "PENDING" || a.status === "CONFIRMED") && <Button variant="ghost" disabled={action.isPending} onClick={() => update(a, "CANCELLED")}>إلغاء الموعد</Button>}
    </div>;
  }
  if (queues.isPending) return <Spinner />;
  if (queues.isError) return <div role="alert" className="card p-5">{apiErrorMessage(queues.error)} <Button onClick={() => void queues.refetch()}>إعادة المحاولة</Button></div>;
  return <div className="space-y-5">
    <NoShowSmsDialog target={dialog?.target ?? null} mode={dialog?.mode} onClose={() => setDialog(null)} onConfirm={async () => { if (dialog) await action.mutateAsync({ appointment: dialog.appointment, kind: dialog.mode === "call" ? "late" : "NO_SHOW" }); }} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{appointmentsView ? "مواعيد الأطباء" : "استقبال العيادة"}</h1><p className="mt-1 text-sm text-slate-600">جميع الأطباء المرتبطين بك في شاشة واحدة. تظهر نداءاتهم تلقائيًا.</p></div>
      <Button variant="outline" onClick={() => {
        if (!sound) { try { audio.current ??= new AudioContext(); chime(audio.current); } catch { showToast("المتصفح لا يدعم التنبيه الصوتي.", "error"); return; } }
        setSound(value => !value);
      }}>{sound ? <Bell /> : <BellOff />}{sound ? "إيقاف الصوت" : "تفعيل صوت النداء"}</Button>
    </div>
    {!queues.data.length && <p className="card p-5">لا يوجد أطباء مرتبطون بك حاليًا. تواصل مع مالك العيادة.</p>}
    <section aria-label="نداءات الأطباء الحالية" aria-live="polite" className="grid gap-3 md:grid-cols-2">
      {queues.data.map(({ doctor, queue }) => <div key={doctor.id} className={`rounded-xl border p-4 ${queue.current ? "border-green-300 bg-green-50" : "border-slate-200 bg-white"}`}>
        <h2 className="font-bold">{doctorName(doctor)}</h2>
        {queue.current ? <><p className="mt-3 flex items-center gap-2 text-lg font-bold text-green-800"><Megaphone className="h-5 w-5 shrink-0" />نادى على: {patientName(queue.current)}</p><p className="my-2 text-sm text-slate-600">{queue.current.calledAt && `وقت النداء: ${new Date(queue.current.calledAt).toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" })}`}</p>{actions(queue.current)}</> : <p className="mt-3 text-sm text-slate-500">لا يوجد مريض منادى عليه الآن</p>}
        <p className="mt-3 text-sm">في الانتظار: {queue.waiting.length + queue.late.length}</p>
      </div>)}
    </section>
    {appointmentsView ? <section className="space-y-3">
      <label className="block font-semibold">تاريخ المواعيد<input aria-label="تاريخ المواعيد" className="input mt-2 block" type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label>
      {appointments.isPending ? <Spinner /> : appointments.isError ? <p role="alert">{apiErrorMessage(appointments.error)}</p> : !appointments.data.length ? <p className="card p-5">لا توجد مواعيد في هذا اليوم.</p> : appointments.data.map(a => <article key={a.id} className="card space-y-3 p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{patientName(a)}</h3><AppointmentStatusBadge status={a.status} /></div><p className="text-sm text-slate-600">{doctorName(a.doctor)} · {a.startTime}</p>{actions(a)}</article>)}
    </section> : <section className="space-y-3"><h2 className="text-lg font-bold">طوابير اليوم</h2>{queues.data.map(({ doctor, queue }) => <section key={doctor.id} className="card space-y-3 p-4"><h3 className="font-bold">{doctorName(doctor)}</h3>{!(queue.ordered ?? [...queue.waiting, ...queue.late]).length && <p className="text-sm text-slate-500">لا يوجد مرضى في الانتظار.</p>}{(queue.ordered ?? [...queue.waiting, ...queue.late]).map((a, index) => <article key={a.id} className="space-y-2 border-t border-slate-100 pt-3"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{index + 1}. {patientName(a)}</span><AppointmentStatusBadge status={a.status} /></div><p className="text-sm text-slate-500">{a.startTime}{a.arrivedAt ? " · وصل إلى العيادة" : ""}</p>{actions(a)}</article>)}</section>)}</section>}
    <p className="text-xs text-slate-500">تحديث النداءات تلقائيًا كل 4 ثوانٍ أثناء فتح هذه الشاشة.</p>
  </div>;
}
