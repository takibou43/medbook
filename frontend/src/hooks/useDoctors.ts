import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Doctor, Paginated } from "../types";

export interface DoctorFilters {
  specialtyId?: string;
  wilayaId?: string;
  cityId?: string;
  gender?: string;
  q?: string;
  minRating?: number;
  page?: number;
}

export function useDoctors(filters: DoctorFilters) {
  return useQuery({
    queryKey: ["doctors", filters],
    queryFn: async () => (await api.get<{ data: Paginated<Doctor> }>("/doctors", { params: filters })).data.data,
  });
}

export function useDoctor(id?: string) {
  return useQuery({
    enabled: !!id,
    queryKey: ["doctor", id],
    queryFn: async () => (await api.get<{ data: Doctor }>(`/doctors/${id}`)).data.data,
  });
}

export function useDoctorAvailability(id?: string, date?: string) {
  return useQuery({
    enabled: !!id && !!date,
    queryKey: ["doctor-availability", id, date],
    queryFn: async () => (await api.get<{ data: { date: string; slots: string[] } }>(`/doctors/${id}/availability`, { params: { date } })).data.data,
  });
}
