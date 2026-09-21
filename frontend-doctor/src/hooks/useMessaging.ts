import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useToast } from "../components/ui/Toast";

export interface ChatMessage {
  id: string;
  senderRole: "ADMIN" | "DOCTOR";
  content: string;
  readAt: string | null;
  createdAt: string;
}
export interface MessagesPage {
  items: ChatMessage[];
  hasMore: boolean;
}
export interface ConversationSummary {
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastSenderRole: "ADMIN" | "DOCTOR" | null;
  unread: number;
}
export interface AdminUnread {
  unread: number;
  conversationsWithUnread: number;
  latest: { doctorId: string; doctorName: string; preview: string | null; fromRole: string | null; at: string } | null;
}

// polling خفيف: يتوقف تلقائيًا عندما تكون التبويبة مخفية (refetchIntervalInBackground=false افتراضيًا).
const UNREAD_POLL_MS = 30_000;
const CHAT_POLL_MS = 5_000;

export type MessagingScope = { kind: "admin"; doctorId: string } | { kind: "doctor" };

const base = (s: MessagingScope) => (s.kind === "admin" ? `/admin/messages/conversations/${s.doctorId}` : "/doctor/messages");
const listUrl = (s: MessagingScope) => (s.kind === "admin" ? `${base(s)}/messages` : "/doctor/messages");
const readUrl = (s: MessagingScope) => (s.kind === "admin" ? `${base(s)}/read` : "/doctor/messages/read");

export function useAdminUnread(enabled = true) {
  return useQuery({
    queryKey: ["msg-admin-unread"],
    enabled,
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async () => (await api.get("/admin/messages/unread-count")).data.data as AdminUnread,
  });
}

export function useDoctorUnread(enabled = true) {
  return useQuery({
    queryKey: ["msg-doctor-unread"],
    enabled,
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async () => (await api.get("/doctor/messages/unread-count")).data.data as { unread: number },
  });
}

export function useConversationList(q: string) {
  return useQuery({
    queryKey: ["msg-conversations", q],
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async () =>
      (await api.get("/admin/messages/conversations", { params: { q: q || undefined, pageSize: 50 } })).data.data as {
        items: ConversationSummary[];
        total: number;
      },
  });
}

/** يعرض 🔔 عند ارتفاع عدد غير المقروء عمّا كان (لا عند أول تحميل). */
export function useUnreadToast(unread: number | undefined, text: () => string, href?: string) {
  const { showToast } = useToast();
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (unread === undefined) return;
    if (prev.current !== null && unread > prev.current) showToast(`🔔 ${text()}`, "info", href);
    prev.current = unread;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);
}

/** آخر صفحة رسائل (الأحدث) مع استطلاع دوري ما دامت المحادثة مفتوحة. الأقدم تُحمَّل بـ before. */
export function useLatestMessages(scope: MessagingScope) {
  return useQuery({
    queryKey: ["msg-thread", scope.kind, scope.kind === "admin" ? scope.doctorId : "me"],
    refetchInterval: CHAT_POLL_MS,
    staleTime: 0,
    queryFn: async () => (await api.get(listUrl(scope), { params: { limit: 30 } })).data.data as MessagesPage,
  });
}

export async function fetchOlder(scope: MessagingScope, before: string) {
  return (await api.get(listUrl(scope), { params: { limit: 30, before } })).data.data as MessagesPage;
}

export function useSendMessage(scope: MessagingScope) {
  const qc = useQueryClient();
  return useMutation({
    // clientId يُولَّد مرة واحدة لكل محاولة إرسال ويُعاد استعماله عند إعادة المحاولة => لا تكرار في الخادم.
    mutationFn: async (vars: { content: string; clientId: string }) =>
      (await api.post(listUrl(scope), vars)).data.data as ChatMessage,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msg-thread"] });
      qc.invalidateQueries({ queryKey: ["msg-conversations"] });
    },
  });
}

export function useMarkRead(scope: MessagingScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.patch(readUrl(scope))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msg-admin-unread"] });
      qc.invalidateQueries({ queryKey: ["msg-doctor-unread"] });
      qc.invalidateQueries({ queryKey: ["msg-conversations"] });
    },
  });
}

export function formatMsgTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ar-DZ", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "الآن";
  const m = Math.floor(s / 60);
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  return `منذ ${Math.floor(h / 24)} يوم`;
}
