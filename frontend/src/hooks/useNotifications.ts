import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Notification } from "../types";

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<{ data: Notification[] }>("/notifications")).data.data,
    refetchInterval: 30_000,
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => api.patch("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
