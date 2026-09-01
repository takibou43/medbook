import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Appointment, AppointmentStatus } from "../types";

export function useMyAppointments(status?: AppointmentStatus, date?: string) {
  return useQuery({
    queryKey: ["appointments", "mine", status, date],
    queryFn: async () => (await api.get<{ data: Appointment[] }>("/appointments", { params: { status, date } })).data.data,
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
