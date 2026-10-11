import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { newRequestItem, type PrescriptionRequestItem } from "../../lib/prescription";
import { t } from "../../i18n/locale.ts";

/** قسم قابل للطي لطلبات التحاليل أو الأشعة/الفحوصات: عدة عناصر، لكل عنصر اسم وتعليمات اختيارية. بلا اقتراحات تلقائية. */
export function RequestItems({ title, addLabel, items, errors, onChange, kind }: {
  title: string; addLabel: string; kind: "labs" | "imaging";
  items: PrescriptionRequestItem[]; errors?: Record<string, string>;
  onChange: (next: PrescriptionRequestItem[]) => void;
}) {
  const [open, setOpen] = useState(items.length > 0);
  const shown = items.length ? items : [];
  const hasError = shown.some(i => errors?.[i.id]);
  const isOpen = open || hasError;
  const update = (id: string, patch: Partial<PrescriptionRequestItem>) => onChange(items.map(i => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <section className="rounded-xl border border-slate-200" data-section={kind}>
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-sm font-bold text-slate-800" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        <span>{title}{shown.length > 0 && <span className="ms-2 badge bg-primary-50 text-primary-700">{shown.length}</span>}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {isOpen && (
        <div className="space-y-2 border-t border-slate-100 p-3">
          {shown.length === 0 && <p className="text-xs text-slate-500">{t("لا توجد عناصر بعد.")}</p>}
          {shown.map((it, i) => (
            <div key={it.id} className="flex items-start gap-2" role="group" aria-label={`${title} ${i + 1}`}>
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-0.5 block font-medium text-slate-600">{t("الاسم")}</span>
                  <input className="input py-2" dir="auto" translate="no" autoComplete="off" value={it.name} onChange={e => update(it.id, { name: e.target.value })} aria-invalid={Boolean(errors?.[it.id])} data-field="name" />
                  {errors?.[it.id] && <span className="mt-1 block text-red-700">{t(errors[it.id])}</span>}
                </label>
                <label className="block text-xs">
                  <span className="mb-0.5 block font-medium text-slate-600">{t("تعليمات")} ({t("اختياري")})</span>
                  <input className="input py-2" dir="auto" translate="no" autoComplete="off" value={it.note} onChange={e => update(it.id, { note: e.target.value })} data-field="note" />
                </label>
              </div>
              <button type="button" onClick={() => onChange(items.filter(x => x.id !== it.id))} className="mt-5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label={`${t("حذف")} ${i + 1}`}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="btn-outline" onClick={() => onChange([...items, newRequestItem()])}>
            <Plus className="h-4 w-4" aria-hidden="true" /> {addLabel}
          </button>
        </div>
      )}
    </section>
  );
}
