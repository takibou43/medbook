import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Doctor, NextSlot, Paginated } from "../types";

export interface DoctorFilters {
  specialtyId?: string;
  wilayaId?: string;
  cityId?: string;
  gender?: string;
  q?: string;
  minRating?: number;
  page?: number;
  // موقع المريض — عند إرسالها معًا يرتّب الخادم النتائج بالأقرب أولًا ويُرجع distanceKm.
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
}

export function useDoctors(filters: DoctorFilters, enabled = true) {
  return useQuery({
    enabled,
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

// أقرب دور متاح للطبيب — نفس المسار المستعمل في صفحة الحجز (booking/next-slot)، يُعاد
// استعماله هنا لعرض "🕐 أقرب موعد" في بطاقة/ملف الطبيب دون أي منطق جديد في الخادم.
// retry: false + عدم إظهار خطأ: قد لا يوجد دور متاح قريبًا وهذا وضع طبيعي، لا عطل.
export function useNextSlotPreview(doctorId?: string, enabled = true) {
  return useQuery({
    enabled: Boolean(doctorId) && enabled,
    queryKey: ["next-slot-preview", doctorId],
    queryFn: async () => (await api.get<{ data: NextSlot }>("/booking/next-slot", { params: { doctorId } })).data.data,
    retry: false,
    staleTime: 20000,
  });
}

export function useDoctorAvailability(id?: string, date?: string) {
  return useQuery({
    enabled: !!id && !!date,
    queryKey: ["doctor-availability", id, date],
    queryFn: async () => (await api.get<{ data: { date: string; slots: string[] } }>(`/doctors/${id}/availability`, { params: { date } })).data.data,
  });
}
