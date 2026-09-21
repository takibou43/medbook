import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, MessageSquare, Search } from "lucide-react";
import clsx from "clsx";
import { apiErrorMessage } from "../../lib/api";
import { Spinner, ErrorState } from "../../components/ui/States";
import { ChatPane } from "../../components/messages/ChatPane";
import { useConversationList, timeAgo } from "../../hooks/useMessaging";

export default function AdminMessages() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("doctor");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useConversationList(debounced);
  const current = list.data?.items.find((c) => c.doctorId === selected);

  const select = (id: string | null) => setParams(id ? { doctor: id } : {}, { replace: false });

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900">
        <MessageSquare className="h-6 w-6 text-primary-600" />
        الرسائل
      </h1>

      <div className="card grid h-[75vh] min-h-[460px] grid-cols-1 overflow-hidden p-0 md:grid-cols-[320px_1fr]">
        {/* قائمة المحادثات: على الهاتف تختفي عند فتح محادثة */}
        <div className={clsx("flex min-h-0 flex-col border-slate-200 md:border-l", selected ? "hidden md:flex" : "flex")}>
          <div className="relative border-b border-slate-200 p-3">
            <Search className="pointer-events-none absolute right-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث عن طبيب..." className="input pr-9" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isLoading ? (
              <Spinner />
            ) : list.isError && !list.data ? (
              <ErrorState message={apiErrorMessage(list.error)} />
            ) : list.data && list.data.items.length > 0 ? (
              list.data.items.map((c) => (
                <button
                  key={c.doctorId}
                  onClick={() => select(c.doctorId)}
                  className={clsx(
                    "flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-right transition hover:bg-slate-50",
                    c.doctorId === selected && "bg-primary-50"
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
                    {c.doctorName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={clsx("truncate text-sm", c.unread > 0 ? "font-extrabold text-slate-900" : "font-semibold text-slate-800")}>
                        د. {c.doctorName}
                      </p>
                      {c.lastMessageAt && <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(c.lastMessageAt)}</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {c.lastMessagePreview ? `${c.lastSenderRole === "ADMIN" ? "أنت: " : ""}${c.lastMessagePreview}` : c.specialty ?? "لا توجد رسائل بعد"}
                    </p>
                  </div>
                  {c.unread > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{c.unread}</span>
                  )}
                </button>
              ))
            ) : (
              <p className="p-6 text-center text-sm text-slate-500">{debounced ? "لا نتائج مطابقة." : "لا يوجد أطباء بعد."}</p>
            )}
          </div>
        </div>

        <div className={clsx("min-h-0 flex-col", selected ? "flex" : "hidden md:flex")}>
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                <button onClick={() => select(null)} className="btn-ghost !p-1.5 md:hidden" aria-label="رجوع لقائمة المحادثات">
                  <ArrowRight className="h-5 w-5" />
                </button>
                <div>
                  <p className="font-bold text-slate-800">{current ? `د. ${current.doctorName}` : "المحادثة"}</p>
                  {current?.specialty && <p className="text-xs text-slate-500">{current.specialty}</p>}
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <ChatPane scope={{ kind: "admin", doctorId: selected }} me="ADMIN" peerLabel={current ? `د. ${current.doctorName}` : "الطبيب"} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
              <MessageSquare className="h-12 w-12" />
              <p className="text-sm">اختر طبيبًا لبدء المحادثة</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
