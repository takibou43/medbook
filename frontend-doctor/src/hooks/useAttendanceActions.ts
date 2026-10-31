import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { useLiveUpdates } from "../context/LiveUpdatesContext";
import { shiftPollInterval } from "../lib/livePolling";
import { type ShiftState, shiftQueryKey } from "../lib/shiftHeartbeat";

/** Share the shift cache with ShiftControl and its heartbeat, including assistant handoffs. */
export function useAttendanceState() {
  const { user } = useAuth();
  const live = useLiveUpdates();
  const shift = useQuery({
    queryKey: shiftQueryKey(user?.id ?? ""),
    enabled: user?.role === "DOCTOR" || user?.role === "ASSISTANT",
    queryFn: async () => (await api.get<{ data: ShiftState }>("/shifts")).data.data,
    refetchInterval: shiftPollInterval(live, 10000),
    refetchIntervalInBackground: false,
  });
  const hasActiveAssistant = shift.isError ? undefined : shift.data?.hasActiveAssistant;
  const canManageAttendance = !shift.isError && (
    user?.role === "ASSISTANT"
      ? shift.data?.active === true && !!shift.data.endsAt && new Date(shift.data.endsAt).getTime() > Date.now()
      : user?.role === "DOCTOR" && hasActiveAssistant === false
  );
  return { hasActiveAssistant, canManageAttendance };
}

export function useAttendanceActions() {
  return useAttendanceState().canManageAttendance;
}
