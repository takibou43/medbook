import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isUpcomingSlot, nextSlotKey, NEXT_SLOT_STALE_MS } from "../lib/nextSlot";
import type { NextSlot } from "../types";

// Cards and the booking step share requests and cache; only the selected slot polls.
export function useNextSlot(doctorId: string | undefined, enabled: boolean, poll = false) {
  return useQuery({
    queryKey: nextSlotKey(doctorId),
    queryFn: async ({ signal }) => (await api.get<{ data: NextSlot }>("/booking/next-slot", {
      params: { doctorId }, signal,
    })).data.data,
    enabled: Boolean(doctorId) && enabled,
    retry: false,
    staleTime: query => isUpcomingSlot(query.state.data) ? NEXT_SLOT_STALE_MS : 0,
    refetchOnWindowFocus: false,
    refetchInterval: poll ? NEXT_SLOT_STALE_MS : false,
    refetchIntervalInBackground: false,
  });
}
