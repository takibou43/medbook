import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Appointment, AppointmentStatus } from "../types";

// كل كم ثانية نسأل الخادم عن مواعيد جديدة (تحديث تلقائي بدون إعادة تحميل الصفحة).
export const APPOINTMENTS_POLL_MS = 15000;

export function useMyAppointments(status?: AppointmentStatus, date?: string) {
  return useQuery({
    queryKey: ["appointments", "mine", status, date],
    queryFn: async () => (await api.get<{ data: Appointment[] }>("/appointments", { params: { status, date } })).data.data,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appointments"] }),
  });
}
