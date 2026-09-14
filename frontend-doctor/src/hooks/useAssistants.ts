import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AssistantAccount, AssistantInviteItem } from "../types";

// كل عمليات إدارة المساعدين تُبطل نفس المفتاح فور نجاحها حتى تنعكس القائمة (حالة الدعوة،
// تفعيل/تعطيل المساعد) مباشرة دون إعادة تحميل الصفحة يدويًا.
const ASSISTANTS_KEY = ["assistants"];

export interface AssistantsListResponse {
  assistants: AssistantAccount[];
  invites: AssistantInviteItem[];
}

export function useAssistantsList() {
  return useQuery({
    queryKey: ASSISTANTS_KEY,
    queryFn: async () => (await api.get<{ data: AssistantsListResponse }>("/doctor/assistants")).data.data,
  });
}

export function useInviteAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) =>
      (await api.post<{ data: { invite: AssistantInviteItem; token: string } }>("/doctor/assistants/invite", { email }))
        .data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSISTANTS_KEY }),
  });
}

export function useResendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) =>
      (
        await api.post<{ data: { invite: AssistantInviteItem; token: string } }>(
          `/doctor/assistants/invites/${inviteId}/resend`
        )
      ).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSISTANTS_KEY }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => (await api.post(`/doctor/assistants/invites/${inviteId}/revoke`)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSISTANTS_KEY }),
  });
}

export function useSetAssistantActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      (await api.patch(`/doctor/assistants/${id}/status`, { isActive })).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSISTANTS_KEY }),
  });
}
