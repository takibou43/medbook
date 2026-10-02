import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Appointment, AppointmentStatus } from "../types";

// كل كم ثانية نسأل الخادم عن مواعيد جديدة (تحديث تلقائي بدون إعادة تحميل الصفحة).
export const APPOINTMENTS_POLL_MS = 15000;

/** `range`: فترة شاملة من/إلى (YYYY-MM-DD) — يومان متساويان = يوم واحد. */
export function useMyAppointments(status?: AppointmentStatus, range?: { from?: string; to?: string }) {
  const from = range?.from;
  const to = range?.to;
  return useQuery({
    queryKey: ["appointments", "mine", status, from, to],
    queryFn: async () => (await api.get<{ data: Appointment[] }>("/appointments", { params: { status, from, to } })).data.data,
    // عند تغيير الفلتر نُبقي القائمة السابقة ظاهرة حتى تصل الجديدة — بلا قفز ولا شاشة تحميل كاملة.
    placeholderData: keepPreviousData,
    // تحديث دوري + عند العودة إلى النافذة، حتى يرى الطبيب الحجز الجديد فورًا.
    refetchInterval: APPOINTMENTS_POLL_MS,
    // لا نستهلك الشبكة (ولا ساعات الخادم) عندما يكون التبويب في الخلفية.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useUpdateAppointmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AppointmentStatus }) =>
      (await api.patch(`/appointments/${id}`, { status })).data.data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["doctor-dashboard"] });
    },
  });
}
