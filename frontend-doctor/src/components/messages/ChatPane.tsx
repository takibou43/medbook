import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLanguage } from "../../i18n/locale.ts";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Loader2, Send } from "lucide-react";
import clsx from "clsx";
import { apiErrorMessage } from "../../lib/api";
import { Spinner, ErrorState } from "../ui/States";
import { useToast } from "../ui/Toast";
import {
  ChatMessage,
  MessagingScope,
  fetchOlder,
  formatMsgTime,
  useLatestMessages,
  useMarkRead,
  useSendMessage,
} from "../../hooks/useMessaging";

const MAX = 2000;

/** نافذة محادثة واحدة (مشتركة بين الإدارة والطبيب). `me` = دور من يشاهد الآن. */
export function ChatPane({
  scope,
  me,
  peerLabel,
  initialDraft = "",
  onDraftChange,
  initialAttempt,
  onAttemptChange,
  focusUnread = false,
  onFocusHandled,
}: {
  scope: MessagingScope;
  me: "ADMIN" | "DOCTOR";
  peerLabel: string;
  initialDraft?: string;
  initialAttempt?: { content: string; clientId: string };
  onAttemptChange?: (attempt: { content: string; clientId: string } | undefined) => void;
  onDraftChange?: (text: string) => void;
  /** عند الوصول من إشعار: مرِّر إلى أول رسالة واردة غير مقروءة (أو آخر رسالة واردة) وأبرزها. */
  focusUnread?: boolean;
  onFocusHandled?: () => void;
}) {
  useLanguage();
  const { showToast } = useToast();
  const latest = useLatestMessages(scope);
  const send = useSendMessage(scope);
  const markRead = useMarkRead(scope);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, updateText] = useState(initialDraft);
  const sending = useRef(false);
  const setText = (value: string) => { updateText(value); onDraftChange?.(value); };
  const pendingId = useRef<{ content: string; clientId: string } | null>(initialAttempt ?? null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const scopeKey = scope.kind === "admin" ? scope.doctorId : "me";
  useEffect(() => {
    setOlder([]);
    setHasMoreOlder(null);
    setText(initialDraft);
    stickToBottom.current = true;
  }, [scopeKey]);

  // دمج بلا تكرار (بالمعرّف) بين الصفحة الأحدث المُستطلَعة والأقدم المحمَّلة يدويًا.
  const messages = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    [...older, ...(latest.data?.items ?? [])].forEach((m) => map.set(m.id, m));
    return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [older, latest.data, getLanguage()]);
  const hasMore = hasMoreOlder ?? latest.data?.hasMore ?? false;

  // وضع الرسائل الواردة كمقروءة عند فتح المحادثة أو وصول رسالة جديدة أثناء فتحها والتبويبة ظاهرة.
  const unreadIncoming = messages.filter((m) => m.senderRole !== me && !m.readAt).length;
  useEffect(() => {
    if (unreadIncoming > 0 && document.visibilityState === "visible" && !markRead.isPending) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadIncoming, scopeKey]);

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // وصول من إشعار: نحدّد الرسالة مرة واحدة قبل أن يقلبها وضع "مقروءة" (نفس الرسم، الأثر يلي تحديث الاستعلام).
  useEffect(() => {
    if (!focusUnread || !latest.data) return;
    const incoming = messages.filter((m) => m.senderRole !== me);
    const target = incoming.find((m) => !m.readAt) ?? incoming[incoming.length - 1];
    if (target) {
      stickToBottom.current = false;
      setHighlightId(target.id);
    }
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUnread, latest.data]);

  useEffect(() => {
    if (!highlightId) return;
    const raf = requestAnimationFrame(() => document.getElementById(`msg-${highlightId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [highlightId]);

  async function loadOlder() {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    const prevHeight = listRef.current?.scrollHeight ?? 0;
    try {
      const page = await fetchOlder(scope, messages[0].id);
      stickToBottom.current = false;
      setOlder((o) => [...page.items, ...o]);
      setHasMoreOlder(page.hasMore);
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight - prevHeight;
      });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || send.isPending || sending.current) return;
    sending.current = true;
    if (!pendingId.current || pendingId.current.content !== content) {
      pendingId.current = { content, clientId: crypto.randomUUID() };
      onAttemptChange?.(pendingId.current);
    }
    try {
      await send.mutateAsync(pendingId.current);
      setText("");
      pendingId.current = null;
      onAttemptChange?.(undefined);
      stickToBottom.current = true;
      showToast(t("تم إرسال الرسالة"), "success");
    } catch (err) {
      showToast(apiErrorMessage(err, t("تعذّر إرسال الرسالة.")), "error");
    } finally {
      sending.current = false;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4"
      >
        {latest.isLoading ? (
          <Spinner />
        ) : latest.isError && !latest.data ? (
          <ErrorState message={apiErrorMessage(latest.error)} />
        ) : (
          <>
            {hasMore && (
              <div className="text-center">
                <button onClick={loadOlder} disabled={loadingOlder} className="btn-ghost !py-1.5 text-xs">
                  {loadingOlder && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("تحميل رسائل أقدم ")}</button>
              </div>
            )}
            {messages.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">
                <p className="font-semibold text-slate-700">{t("لا توجد رسائل بعد")}</p>
                <p className="mt-1">{t("ابدأ المحادثة مع ")}{peerLabel}{t(" بإرسال رسالة.")}</p>
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.senderRole === me;
                return (
                  <div key={m.id} className={clsx("flex", mine ? "justify-start" : "justify-end")}>
                    <div
                      id={`msg-${m.id}`}
                      className={clsx(
                        "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm transition sm:max-w-[70%]",
                        mine ? "bg-primary-600 text-white" : "border border-slate-200 bg-white text-slate-800",
                        highlightId === m.id && "ring-2 ring-primary-500 ring-offset-2"
                      )}
                    >
                      {/* نص خام: يُعرض كنص (React يهرّب) مع الحفاظ على الأسطر — لا HTML أبدًا */}
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={clsx("mt-1 flex items-center gap-1 text-[11px]", mine ? "text-primary-100" : "text-slate-400")}>
                        {formatMsgTime(m.createdAt)}
                        {mine && (m.readAt ? <CheckCheck className="h-3.5 w-3.5" aria-label={t("مقروءة")} /> : <Check className="h-3.5 w-3.5" aria-label={t("مُرسلة")} />)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-slate-200 bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            aria-label={t("رسالة إلى {0}", { "0": peerLabel })}
            disabled={send.isPending}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) submit(e as unknown as FormEvent);
            }}
            maxLength={MAX}
            rows={2}
            placeholder={t("اكتب رسالتك...")}
            className="input min-h-[44px] flex-1 resize-none"
          />
          <button type="submit" disabled={!text.trim() || send.isPending} className="btn-primary h-11 shrink-0">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -scale-x-100" />}{t("إرسال ")}</button>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">{t("Enter للإرسال، Shift+Enter لسطر جديد — ")}{text.length}/{MAX}
        </p>
      </form>
    </div>
  );
}
