import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Appointment } from "../types";
import { useLiveUpdates } from "../context/LiveUpdatesContext";
import { livePollInterval } from "../lib/livePolling";

// طابور العيادة يتغيّر لحظيًا (حجز جديد، مريض دخل، آخر تأخّر)، فنُحدّثه أسرع من بقية
// الصفحات — مع التوقف عندما يكون التبويب في الخلفية حتى لا نُرهق الخادم المجاني.
export const QUEUE_POLL_MS = 10000;

export interface QueueState {
  date: string;
  current: Appointment | null;
  waiting: Appointment[];
  late: Appointment[];
  // الترتيب الفعلي المتوقع للمناداة (المنتظرون والمتأخرون معًا)، محسوبًا في الخادم بنفس قاعدة «نادِ التالي».
  // اختياري حتى تبقى الواجهة تعمل مع خادم قديم لم يُحدَّث بعد.
  ordered?: (Appointment & { position: number })[];
  // متوسط مدة الجلسة لهذا الطبيب (من المناداة إلى الإنهاء، آخر الجلسات المكتملة الصالحة) —
  // ليس وقت انتظار مريض بعينه. isFallback=true: بيانات غير كافية فالقيمة افتراضية لا تُعرض كتقدير.
  estimatedDurationMinutes: number;
  estimatedDurationIsFallback?: boolean;
  estimatedDurationSamples?: number;
  // ملخص مواعيد اليوم حسب الحالة (اختياري مع خادم قديم).
  todaySummary?: { total: number; completed: number; noShow: number; cancelled: number; pending: number; rescheduleRequired: number };
}

// المساعد يحتاج أن يرى المريض الذي نادى عليه الطبيب في ثوانٍ، فنُسرّع التحديث عنده فقط.
export const ASSISTANT_QUEUE_POLL_MS = 4000;

export function useQueue(pollMs: number = QUEUE_POLL_MS) {
  const live = useLiveUpdates();
  return useQuery({
    queryKey: ["queue"],
    queryFn: async () => (await api.get<{ data: QueueState }>("/appointments/queue")).data.data,
    refetchInterval: livePollInterval(live, pollMs),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

// كل عمليات الطابور تُبطل ذاكرة الطابور وقائمة المواعيد معًا، لأن أي تغيير هنا ينعكس
// مباشرة على الصفحتين ولا نريد أرقامًا متناقضة بين شاشتين مفتوحتين.
function useQueueMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["doctor-dashboard"] });
    },
  });
}

export function useCallNext() {
  return useQueueMutation<void>(async () => (await api.post("/appointments/queue/next")).data.data);
}

export function useCallPatient() {
  return useQueueMutation<string>(async (id) => (await api.post("/appointments/" + id + "/call")).data.data);
}

export function useMarkLate() {
  return useQueueMutation<string>(async (id) => (await api.post("/appointments/" + id + "/late")).data.data);
}

export function useMarkArrived() {
  return useQueueMutation<string>(async (id) => (await api.post("/appointments/" + id + "/arrived")).data.data);
}

export function useFinishAppointment() {
  return useQueueMutation<string>(async (id) => (await api.patch("/appointments/" + id, { status: "COMPLETED" })).data.data);
}

export function useMarkNoShow() {
  return useQueueMutation<string>(async (id) => (await api.patch("/appointments/" + id, { status: "NO_SHOW" })).data.data);
}
