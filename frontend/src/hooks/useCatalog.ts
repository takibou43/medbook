import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Specialty, Wilaya } from "../types";

export function useSpecialties() {
  return useQuery({
    queryKey: ["specialties"],
    queryFn: async () => (await api.get<{ data: Specialty[] }>("/specialties")).data.data,
  });
}

export function useWilayas() {
  return useQuery({
    queryKey: ["wilayas"],
    queryFn: async () => (await api.get<{ data: Wilaya[] }>("/wilayas")).data.data,
  });
}
