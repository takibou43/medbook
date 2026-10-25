import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { useLiveUpdates } from "../context/LiveUpdatesContext";
import { shiftPollInterval } from "../lib/livePolling";

/** Reception handles absence when an active assistant is available. */
export function useAttendanceActions() {
  const { user } = useAuth();
  const live = useLiveUpdates();
  const { data } = useQuery({
    queryKey: ["assistants", "attendance", user?.id],
    enabled: user?.role === "DOCTOR",
    queryFn: async () => (await api.get<{ data: { hasActiveAssistant: boolean } }>("/doctor/assistants/attendance")).data.data,
    refetchInterval: 30000,
  });
  const shift = useQuery({ queryKey: ["shift", user?.id], enabled: user?.role === "ASSISTANT", queryFn: async () => (await api.get<{ data: { active: boolean } }>("/shifts")).data.data, refetchInterval: shiftPollInterval(live, 10000), refetchIntervalInBackground: false });
  return (user?.role === "ASSISTANT" && shift.data?.active === true) || (user?.role === "DOCTOR" && data?.hasActiveAssistant === false);
}
