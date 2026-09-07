import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Appointment } from "../types";

// طابور العيادة يتغيّر لحظيًا (حجز جديد، مريض دخل، آخر تأخّر)، فنُحدّثه أسرع من بقية
// الصفحات — مع التوقف عندما يكون التبويب في الخلفية حتى لا نُرهق الخادم المجاني.
export const QUEUE_POLL_MS = 10000;

export interface QueueState {
  date: string;
  current: Appointment | null;
  waiting: Appointment[];
  late: Appointment[];
}

export function useQueue() {
  return useQuery({
    queryKey: ["queue"],
    queryFn: async () => (await api.get<{ data: QueueState }>("/appointments/queue")).data.data,
    refetchInterval: QUEUE_POLL_MS,
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

export function useFinishAppointment() {
  return useQueueMutation<string>(async (id) => (await api.patch("/appointments/" + id, { status: "COMPLETED" })).data.data);
}

export function useMarkNoShow() {
  return useQueueMutation<string>(async (id) => (await api.patch("/appointments/" + id, { status: "NO_SHOW" })).data.data);
}
