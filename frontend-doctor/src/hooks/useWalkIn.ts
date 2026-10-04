import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { WalkInBody } from "../lib/walkIn";

/** أوقات اليوم المتاحة لدى طبيب محدد (لم يمضِ وقتها وغير محجوزة) — نفس مسار الحجز العام. */
export function useTodaySlots(doctorId: string, date: string) {
  return useQuery({
    queryKey: ["today-slots", doctorId, date],
    enabled: Boolean(doctorId),
    queryFn: async () =>
      (await api.get<{ data: { date: string; slotMinutes: number; slots: string[] } }>("/booking/availability", { params: { doctorId, date } })).data.data,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export interface WalkInResult {
  id: string;
  doctorId: string;
  startTime: string;
  endTime: string;
  status: string;
  guestFirstName: string;
  guestLastName: string;
  notes: string | null;
  replayed: boolean;
}

/**
 * POST /appointments/walk-in لطبيب محدد: الطبيب يُرسل في ترويسة هذا الطلب وحده (لا اختيار عام في المتصفح)،
 * والخادم يتحقق أنه ضمن ارتباطات المساعد الفعلية (وإلا 403).
 */
export function useRegisterWalkIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ doctorId, body }: { doctorId: string; body: WalkInBody }) =>
      (await api.post<{ data: WalkInResult }>("/appointments/walk-in", body, { headers: { "X-Assistant-Doctor-Id": doctorId } })).data.data,
    // نجاح أو فشل: طوابير الأطباء وعداداتهم والأوقات المتاحة قد تغيّرت.
    onSettled: (_d, _e, { doctorId }) => {
      void qc.invalidateQueries({ queryKey: ["assistant-queues"] });
      void qc.invalidateQueries({ queryKey: ["assistant-appointments"] });
      void qc.invalidateQueries({ queryKey: ["today-slots", doctorId] });
    },
  });
}
