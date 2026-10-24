import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Specialty, Wilaya } from "../types";

const CATALOG_STALE_MS = 30 * 60 * 1000;

export function useSpecialties() {
  return useQuery({
    queryKey: ["specialties"],
    // فهرس عام نادر التغيّر: لا داعي لإعادة جلبه عند كل تركيز أو فتح صفحة (الخادم يعيد التحقق بـETag).
    staleTime: CATALOG_STALE_MS,
    queryFn: async () => (await api.get<{ data: Specialty[] }>("/specialties")).data.data,
  });
}

export function useWilayas() {
  return useQuery({
    queryKey: ["wilayas"],
    // فهرس عام نادر التغيّر: لا داعي لإعادة جلبه عند كل تركيز أو فتح صفحة (الخادم يعيد التحقق بـETag).
    staleTime: CATALOG_STALE_MS,
    queryFn: async () => (await api.get<{ data: Wilaya[] }>("/wilayas")).data.data,
  });
}
