import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

/** Reception handles absence when an active assistant is available. */
export function useAttendanceActions() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["assistants", "attendance", user?.id],
    enabled: user?.role === "DOCTOR",
    queryFn: async () => (await api.get<{ data: { hasActiveAssistant: boolean } }>("/doctor/assistants/attendance")).data.data,
    refetchInterval: 30000,
  });
  return user?.role === "ASSISTANT" || (user?.role === "DOCTOR" && data?.hasActiveAssistant === false);
}
