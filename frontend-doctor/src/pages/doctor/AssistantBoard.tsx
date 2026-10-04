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
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const appointmentDate = appointmentsView ? date : today;
  const [sound, setSound] = useState(false);
  const [dialog, setDialog] = useState<{ appointment: Appointment; target: NoShowTarget; mode: "call" | "final" } | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<Map<string, string | null>>(new Map());
  const queues = useQuery({ queryKey: ["assistant-queues", user?.id], queryFn: async () => (await api.get<{ data: DoctorQueue[] }>("/assistant/queues")).data.data, refetchInterval: ASSISTANT_QUEUE_POLL_MS, refetchIntervalInBackground: false, refetchOnWindowFocus: true });
  const appointments = useQuery({ queryKey: ["assistant-appointments", user?.id, appointmentDate], queryFn: async () => (await api.get<{ data: BoardAppointment[] }>("/assistant/appointments", { params: { date: appointmentDate } })).data.data, refetchInterval: 15000, refetchIntervalInBackground: false });
  useEffect(() => {
    if (!queues.data) return;
    const rows = queues.data.map(row => ({ doctorId: row.doctor.id, current: row.queue.current }));
    const calls = newlyCalled(rows, previous.current);
    if (calls.length) showToast(`نداء جديد: ${calls.map(call => {
      const doctor = queues.data.find(row => row.doctor.id === call.doctorId)!.doctor;
      return `${patientName(call.current!)} — ${doctorName(doctor)}`;
    }).join("؛ ")}`, "info");
    if (calls.length && sound) chime(audio.current);
    previous.current = callSignatures(rows);
  }, [queues.data, sound, showToast]);
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
  const activeCalls = queues.data.flatMap(({ doctor, queue }) => queue.current ? [{ doctor, appointment: queue.current }] : [])
    .sort((a, b) => (b.appointment.calledAt ?? "").localeCompare(a.appointment.calledAt ?? ""));
  // Use the faster queue response for today's current/waiting rows, keeping the
  // full daily list (including pending/completed appointments) from its own API.
  const liveAppointments = new Map(queues.data.flatMap(({ queue }) => [
    ...(queue.current ? [queue.current] : []), ...queue.waiting, ...queue.late,
  ]).map(appointment => [appointment.id, appointment]));
  const list = (appointments.data ?? []).map(appointment => ({ ...appointment, ...(liveAppointments.get(appointment.id) ?? {}), doctor: appointment.doctor }));
  return <div className="space-y-5">
    <NoShowSmsDialog target={dialog?.target ?? null} mode={dialog?.mode} onClose={() => setDialog(null)} onConfirm={async () => { if (dialog) await action.mutateAsync({ appointment: dialog.appointment, kind: dialog.mode === "call" ? "late" : "NO_SHOW" }); }} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{appointmentsView ? "مواعيد الأطباء" : "استقبال العيادة"}</h1><p className="mt-1 text-sm text-slate-600">قائمة واحدة للمواعيد، والنداءات الجديدة تظهر أعلاها تلقائيًا.</p></div>
      <Button variant="outline" onClick={() => {
        if (!sound) { try { audio.current ??= new AudioContext(); chime(audio.current); } catch { showToast("المتصفح لا يدعم التنبيه الصوتي.", "error"); return; } }
        setSound(value => !value);
      }}>{sound ? <Bell /> : <BellOff />}{sound ? "إيقاف الصوت" : "تفعيل صوت النداء"}</Button>
    </div>
    {!queues.data.length && <p className="card p-5">لا يوجد أطباء مرتبطون بك حاليًا. تواصل مع مالك العيادة.</p>}
    <section aria-label="نداءات الأطباء الحالية" aria-live="polite" className="overflow-hidden rounded-xl border border-green-200 bg-green-50">
      <h2 className="flex items-center gap-2 px-4 py-3 font-bold text-green-900"><Megaphone className="h-5 w-5" />النداءات الحالية{activeCalls.length > 0 && <span className="text-sm">({activeCalls.length})</span>}</h2>
      {!activeCalls.length ? <p className="px-4 pb-3 text-sm text-slate-600">لا يوجد نداء حاليًا.</p> : <ul className="divide-y divide-green-200">
        {activeCalls.map(({ doctor, appointment }) => <li key={doctor.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
          <span className="font-bold text-green-900">{patientName(appointment)}</span>
          <span className="text-sm text-green-800">{doctorName(doctor)}{appointment.calledAt && <span className="mr-3 text-xs text-slate-500">{new Date(appointment.calledAt).toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" })}</span>}</span>
        </li>)}
      </ul>}
    </section>
    <section aria-label="قائمة المواعيد الموحدة" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{appointmentsView ? "المواعيد" : "مواعيد اليوم"}</h2><p className="text-sm text-slate-500">الأطباء المرتبطون بك: {queues.data.length}</p></div>
      {appointmentsView && <label className="block text-sm font-semibold">تاريخ المواعيد<input aria-label="تاريخ المواعيد" className="input mt-2 block" type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label>}
      {appointments.isPending ? <Spinner /> : appointments.isError ? <div role="alert">{apiErrorMessage(appointments.error)} <Button variant="outline" onClick={() => void appointments.refetch()}>إعادة المحاولة</Button></div> : !list.length ? <p className="card p-5">لا توجد مواعيد في هذا اليوم.</p> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div aria-hidden="true" className="hidden grid-cols-[5rem_1.3fr_1fr_7rem_1.5fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 lg:grid"><span>الوقت</span><span>المريض</span><span>الطبيب</span><span>الحالة</span><span>الإجراءات</span></div>
        <ol className="divide-y divide-slate-100">
          {list.map(a => <li key={a.id} className={`grid grid-cols-2 items-center gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-[5rem_1.3fr_1fr_7rem_1.5fr] ${a.status === "IN_PROGRESS" ? "bg-green-50/50" : ""}`}>
            <span className="text-sm tabular-nums">{a.startTime}</span>
            <span className="font-semibold">{patientName(a)}</span>
            <span className="text-sm text-slate-600">{doctorName(a.doctor)}</span>
            <div><AppointmentStatusBadge status={a.status} />{a.arrivedAt && (a.status === "CONFIRMED" || a.status === "LATE") && <span className="mr-2 text-xs text-green-700">وصل</span>}</div>
            <div className="col-span-2 lg:col-span-1">{actions(a)}</div>
          </li>)}
        </ol>
      </div>}
    </section>
    <p className="text-xs text-slate-500">تحديث النداءات تلقائيًا كل 4 ثوانٍ أثناء فتح هذه الشاشة.</p>
  </div>;
}
