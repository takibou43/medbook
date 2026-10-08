import { ReactNode, useEffect, useRef } from "react";
import { MoreHorizontal, X } from "lucide-react";

export function AdminResults({ total, filtered = false, onClear }: { total?: number; filtered?: boolean; onClear?: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
    <p role="status" className="font-medium text-slate-600">{total === undefined ? "" : `عدد النتائج: ${total.toLocaleString("ar-DZ")}`}</p>
    {filtered && onClear && <button type="button" className="btn-ghost" onClick={onClear}><X className="h-4 w-4" aria-hidden />مسح الفلاتر</button>}
  </div>;
}

/** Native disclosure: focusable actions, outside-click dismissal, and Escape return focus. */
export function AdminActions({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return <details ref={ref} className="admin-actions max-w-full" onKeyDown={(event) => {
    if (event.key === "Escape" && ref.current?.open) { event.preventDefault(); event.stopPropagation(); ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
  }}>
    <summary className="btn-outline cursor-pointer" aria-label={`إجراءات ${label}`}><MoreHorizontal className="h-4 w-4" aria-hidden />إجراءات</summary>
    <div className="mt-2 flex max-h-96 w-56 max-w-full flex-col gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg" onClick={(event) => {
      if ((event.target as Element).closest("button") && ref.current) ref.current.open = false;
    }}>{children}</div>
  </details>;
}
