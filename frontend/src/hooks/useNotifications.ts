import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Notification } from "../types";

export function isNotificationExpired(n: Pick<Notification, "expiresAt">, now: number = Date.now()): boolean {
  if (!n.expiresAt) return false;
  const t = Date.parse(n.expiresAt);
  return !Number.isNaN(t) && t <= now;
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<{ data: Notification[] }>("/notifications")).data.data,
    // الخادم لا يُرجع إشعارات المواعيد المنتهية أصلًا؛ هذا حاجز إضافي لبيانات مخزّنة في الذاكرة منذ
    // ما قبل منتصف الليل (تطبيق بقي مفتوحًا): تختفي عند انتهاء يوم الموعد دون انتظار إعادة الجلب.
    select: (list) => list.filter((n) => !isNotificationExpired(n)),
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
