import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { ChevronDown, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import type { PrescriptionMedication } from "../../lib/prescription";
import type { PrescriptionLanguage } from "../../lib/prescriptionPrint";
import { CUSTOM, DOSE_UNITS, DURATION_UNITS, FREQUENCIES, TIMINGS, editableValues, medicationComplete, medicationHasStructuredValues, medicationSummary } from "../../lib/prescriptionMedication";
import { Button } from "../ui/Button";
import { t } from "../../i18n/locale.ts";
import { readMedicationNames, rememberMedicationName } from "../../lib/medicationNames";

type Errors = Partial<Record<"name" | "dose" | "frequency" | "duration" | "instructions", string>>;
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1";
const labelCls = "mb-0.5 block text-xs font-semibold text-slate-700";

const lbl = (o: { ar: string; fr: string }, lang: PrescriptionLanguage) => o[lang];

/** New rows use compact free text; existing structured rows retain their original fields. */
export function MedicationList({ medications, ownerUserId, lang, errors, formId, onUpdate, onRemove, onRestore, onAdd }: {
  medications: PrescriptionMedication[];
  ownerUserId: string;
  lang: PrescriptionLanguage;
  errors: Record<string, Errors | undefined>;
  formId: string;
  onUpdate: (id: string, patch: Partial<PrescriptionMedication>) => void;
  onRemove: (id: string) => void;
  onRestore: (med: PrescriptionMedication, index: number) => void;
  onAdd: () => void;
}) {
  const pendingFocus = useRef(false);
  const choosingSuggestion = useRef(false);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const last = medications[medications.length - 1];
    if (last) document.getElementById(`${formId}-${last.id}-name`)?.focus();
  }, [medications, formId]);
  function addAndFocus() {
    const last = medications[medications.length - 1];
    if (last && !last.name.trim()) { document.getElementById(`${formId}-${last.id}-name`)?.focus(); return; }
    pendingFocus.current = true;
    onAdd();
  }
  function nextOnEnter(event: KeyboardEvent<HTMLInputElement>, next?: string) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (next) document.getElementById(next)?.focus(); else addAndFocus();
  }
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [instrOpen, setInstrOpen] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<{ med: PrescriptionMedication; index: number } | null>(null);
  const [names, setNames] = useState(() => readMedicationNames(ownerUserId));
  const toggle = (set: Set<string>, id: string, on: boolean) => { const n = new Set(set); if (on) n.add(id); else n.delete(id); return n; };

  function remove(m: PrescriptionMedication, index: number) {
    setRemoved({ med: { ...m }, index });
    onRemove(m.id);
  }
  function restore() {
    if (!removed) return;
    onRestore(removed.med, removed.index);
    setRemoved(null);
  }

  return (
    <div>
      <p className="mb-2 text-xs text-slate-600">{t("Enter: الاسم ثم الكمية ثم طريقة الاستعمال؛ بعد التعليمات يُضاف دواء جديد. يعمل Tab كالمعتاد.")}</p>
      <p className="mb-2 text-xs text-slate-600">{t("اقتراحات الأسماء من إدخالاتك السابقة على هذا الجهاز. يمكنك كتابة أي دواء يدويًا.")}</p>
      <datalist id={`${formId}-medication-names`}>
        {names.map(name => <option key={name} value={name} />)}
      </datalist>
      <ol className="divide-y divide-slate-200 rounded-xl border border-slate-200">
        {medications.map((m, i) => {
          const err = errors[m.id];
          const isFree = m.directionsMode === "freeText";
          const isCollapsed = collapsed.has(m.id) && !err && medicationComplete(m);
          const fieldId = (k: string) => `${formId}-${m.id}-${k}`;
          const v = editableValues(m);
          const summary = medicationSummary(m, lang);
          const showInstr = isFree || Boolean(m.instructions.trim()) || instrOpen.has(m.id);
          const errorText = (k: keyof Errors) => err?.[k] ? <span id={fieldId(`${k}-err`)} className="mt-1 block text-xs text-red-700">{t(err[k]!)}</span> : null;
          const describe = (k: keyof Errors) => err?.[k] ? fieldId(`${k}-err`) : undefined;
          const setText = (key: keyof PrescriptionMedication) => (e: { target: { value: string } }) => onUpdate(m.id, { [key]: e.target.value });
          // أي تعديل على مجموعة منظمة يحفظ القيم الفعلية (بما فيها النص القديم) في الحقول الجديدة.
          const dose = (p: Partial<Pick<PrescriptionMedication, "doseQty" | "doseUnit" | "doseCustom">>) => onUpdate(m.id, { doseQty: v.doseQty, doseUnit: v.doseUnit, doseCustom: v.doseCustom, ...p });
          const freq = (p: Partial<Pick<PrescriptionMedication, "freqKey" | "freqCustom">>) => onUpdate(m.id, { freqKey: v.freqKey, freqCustom: v.freqCustom, ...p });
          const dur = (p: Partial<Pick<PrescriptionMedication, "durQty" | "durUnit" | "durCustom">>) => onUpdate(m.id, { durQty: v.durQty, durUnit: v.durUnit, durCustom: v.durCustom, ...p });

          const number = <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-800" aria-hidden="true">{i + 1}</span>;
          const deleteBtn = (
            <button type="button" onClick={() => remove(m, i)} className={clsx("inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-700 hover:bg-red-50", focus)} aria-label={t("حذف الدواء رقم {n}", { n: i + 1 })}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> <span className="max-sm:sr-only">{t("حذف")}</span>
            </button>
          );

          if (isFree) {
            return (
              <li key={m.id} className="p-2.5 sm:p-3" role="group" aria-label={t("الدواء رقم {n}", { n: i + 1 })}>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-start gap-2 sm:grid-cols-[minmax(0,5fr)_minmax(0,2fr)_minmax(0,5fr)_44px]">
                  <label className="col-span-3 min-w-0 sm:col-span-1">
                    <span className={labelCls}>{t("اسم الدواء")}</span>
                    <input id={fieldId("name")} list={`${formId}-medication-names`} onKeyDown={e => {
                      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && names.length) { choosingSuggestion.current = true; return; }
                      if (e.key === "Escape") { choosingSuggestion.current = false; return; }
                      if (e.key === "Enter" && choosingSuggestion.current) { choosingSuggestion.current = false; return; }
                      nextOnEnter(e, fieldId("quantity"));
                    }} enterKeyHint="next" className="input py-2 font-semibold" dir="auto" translate="no" autoComplete="off" spellCheck={false} data-field="name" value={m.name} onChange={setText("name")} onBlur={() => { choosingSuggestion.current = false; setNames(rememberMedicationName(ownerUserId, m.name)); }} aria-invalid={Boolean(err?.name)} aria-describedby={describe("name")} />
                    {(m.strength || m.form) && <span className="block text-xs text-slate-600" dir="auto" translate="no">{[m.strength, m.form].filter(Boolean).join(" ")}</span>}
                    {errorText("name")}
                  </label>
                  <label className="min-w-0">
                    <span className={labelCls}>{t("الكمية المصروفة")}</span>
                    <input id={fieldId("quantity")} onKeyDown={e => nextOnEnter(e, fieldId("instructions"))} enterKeyHint="next" className="input py-2" dir="auto" translate="no" autoComplete="off" value={m.quantity ?? ""} onChange={setText("quantity")} />
                  </label>
                  <label className="min-w-0">
                    <span className={labelCls}>{t("الجرعة وطريقة الاستعمال")}</span>
                    <input id={fieldId("instructions")} onKeyDown={e => nextOnEnter(e)} enterKeyHint="next" className="input py-2" dir="auto" translate="no" autoComplete="off" spellCheck={false} data-field="instructions" value={m.instructions} onChange={setText("instructions")} aria-invalid={Boolean(err?.instructions)} aria-describedby={describe("instructions")} />
                    {errorText("instructions")}
                  </label>
                  <button type="button" onClick={() => remove(m, i)} className={clsx("mt-4 flex h-11 w-11 items-center justify-center rounded-lg text-red-700 hover:bg-red-50", focus)} aria-label={t("حذف الدواء رقم {n}", { n: i + 1 })}><X className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              </li>
            );
          }

          if (isCollapsed) {
            return (
              <li key={m.id} className="flex items-center gap-2 p-2.5" role="group" aria-label={t("الدواء رقم {n}", { n: i + 1 })}>
                {number}
                <p className="min-w-0 flex-1 truncate text-sm text-slate-900"><bdi dir="auto" translate="no" className="font-semibold">{summary}</bdi></p>
                <button type="button" onClick={() => setCollapsed(toggle(collapsed, m.id, false))} className={clsx("inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary-800 hover:bg-primary-50", focus)} aria-expanded="false">
                  <Pencil className="h-4 w-4" aria-hidden="true" /> {t("تعديل")}
                </button>
                {deleteBtn}
              </li>
            );
          }

          return (
            <li key={m.id} className="p-2.5 sm:p-3" role="group" aria-label={t("الدواء رقم {n}", { n: i + 1 })}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {number}
                <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label={t("طريقة كتابة تعليمات الدواء")}>
                  {([["structured", "حقول منظمة"], ["freeText", "تعليمات حرة"]] as const).map(([mode, label]) => (
                    <button key={mode} type="button" aria-pressed={(m.directionsMode ?? "structured") === mode} onClick={() => onUpdate(m.id, { directionsMode: mode })}
                      className={clsx("min-h-9 px-3 text-xs font-semibold", focus, (m.directionsMode ?? "structured") === mode ? "bg-primary-700 text-white" : "bg-white text-slate-700 hover:bg-slate-50")}>{t(label)}</button>
                  ))}
                </div>
                <span className="flex-1" />
                {medicationComplete(m) && (
                  <button type="button" onClick={() => setCollapsed(toggle(collapsed, m.id, true))} className={clsx("inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100", focus)} aria-expanded="true">
                    <ChevronDown className="h-4 w-4" aria-hidden="true" /> <span className="max-sm:sr-only">{t("طي")}</span>
                  </button>
                )}
                {deleteBtn}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                <label className="col-span-2 block min-w-0 sm:col-span-6">
                  <span className={labelCls}>{t("اسم الدواء")}</span>
                  <input id={fieldId("name")} className="input py-2 font-semibold" dir="auto" translate="no" autoComplete="off" spellCheck={false} data-field="name" value={m.name} onChange={setText("name")} aria-invalid={Boolean(err?.name)} aria-describedby={describe("name")} />
                  {errorText("name")}
                </label>
                <label className="col-span-1 block min-w-0 sm:col-span-3">
                  <span className={labelCls}>{t("التركيز")} <span className="font-normal text-slate-600">({t("اختياري")})</span></span>
                  <input id={fieldId("strength")} className="input py-2" dir="auto" translate="no" autoComplete="off" spellCheck={false} placeholder="500 mg" value={m.strength ?? ""} onChange={setText("strength")} />
                </label>
                <label className="col-span-1 block min-w-0 sm:col-span-3">
                  <span className={labelCls}>{t("الشكل الدوائي")} <span className="font-normal text-slate-600">({t("اختياري")})</span></span>
                  <input id={fieldId("form")} className="input py-2" dir="auto" translate="no" autoComplete="off" spellCheck={false} value={m.form ?? ""} onChange={setText("form")} />
                </label>
              </div>

              {!isFree && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="min-w-0">
                    <span className={labelCls} id={fieldId("dose-l")}>{t("الجرعة في كل مرة")}</span>
                    <div className="flex gap-2" role="group" aria-labelledby={fieldId("dose-l")}>
                      <input id={fieldId("dose")} data-field="dose" className="input !w-24 shrink-0 py-2" dir="ltr" inputMode="decimal" autoComplete="off" placeholder={t("الكمية")} aria-label={t("كمية الجرعة")} value={v.doseQty} onChange={e => dose({ doseQty: e.target.value })} aria-invalid={Boolean(err?.dose)} aria-describedby={describe("dose")} />
                      <select className="input min-w-0 flex-1 py-2" aria-label={t("وحدة الجرعة")} value={v.doseUnit} onChange={e => dose({ doseUnit: e.target.value })}>
                        <option value="">{t("اختر الوحدة")}</option>
                        {DOSE_UNITS.map(u => <option key={u.key} value={u.key}>{lbl(u, lang)}</option>)}
                        <option value={CUSTOM}>{t("أخرى…")}</option>
                      </select>
                    </div>
                    {v.doseUnit === CUSTOM && <input className="input mt-2 py-2" dir="auto" translate="no" autoComplete="off" aria-label={t("وصف الجرعة")} placeholder={t("اكتب الجرعة")} value={v.doseCustom} onChange={e => dose({ doseCustom: e.target.value })} />}
                    {errorText("dose")}
                  </div>

                  <div className="min-w-0">
                    <span className={labelCls} id={fieldId("freq-l")}>{t("عدد مرات الاستخدام")}</span>
                    <select id={fieldId("frequency")} data-field="frequency" className="input py-2" aria-labelledby={fieldId("freq-l")} value={v.freqKey} onChange={e => freq({ freqKey: e.target.value })} aria-invalid={Boolean(err?.frequency)} aria-describedby={describe("frequency")}>
                      <option value="">{t("اختر")}</option>
                      {FREQUENCIES.map(o => <option key={o.key} value={o.key}>{lbl(o, lang)}</option>)}
                      <option value={CUSTOM}>{t("أخرى…")}</option>
                    </select>
                    {v.freqKey === CUSTOM && <input className="input mt-2 py-2" dir="auto" translate="no" autoComplete="off" aria-label={t("وصف التكرار")} placeholder={t("اكتب التكرار")} value={v.freqCustom} onChange={e => freq({ freqCustom: e.target.value })} />}
                    {errorText("frequency")}
                  </div>

                  <div className="min-w-0">
                    <span className={labelCls} id={fieldId("timing-l")}>{t("وقت الاستخدام")} <span className="font-normal text-slate-600">({t("اختياري")})</span></span>
                    <select className="input py-2" aria-labelledby={fieldId("timing-l")} value={v.timingKey} onChange={e => onUpdate(m.id, { timingKey: e.target.value })}>
                      <option value="">{t("بدون تحديد")}</option>
                      {TIMINGS.map(o => <option key={o.key} value={o.key}>{lbl(o, lang)}</option>)}
                      <option value={CUSTOM}>{t("أخرى…")}</option>
                    </select>
                    {v.timingKey === CUSTOM && <input className="input mt-2 py-2" dir="auto" translate="no" autoComplete="off" aria-label={t("وصف الوقت")} placeholder={t("اكتب الوقت")} value={v.timingCustom} onChange={e => onUpdate(m.id, { timingCustom: e.target.value })} />}
                  </div>

                  <div className="min-w-0">
                    <span className={labelCls} id={fieldId("dur-l")}>{t("مدة العلاج")}</span>
                    <div className="flex gap-2" role="group" aria-labelledby={fieldId("dur-l")}>
                      <input id={fieldId("duration")} data-field="duration" className="input !w-24 shrink-0 py-2" dir="ltr" inputMode="numeric" autoComplete="off" placeholder={t("العدد")} aria-label={t("عدد وحدات المدة")} value={v.durQty} onChange={e => dur({ durQty: e.target.value })} aria-invalid={Boolean(err?.duration)} aria-describedby={describe("duration")} />
                      <select className="input min-w-0 flex-1 py-2" aria-label={t("وحدة المدة")} value={v.durUnit} onChange={e => dur({ durUnit: e.target.value })}>
                        <option value="">{t("اختر الوحدة")}</option>
                        {DURATION_UNITS.map(u => <option key={u.key} value={u.key}>{lang === "fr" ? u.fr[1] : u.ar[2]}</option>)}
                        <option value={CUSTOM}>{t("أخرى…")}</option>
                      </select>
                    </div>
                    {v.durUnit === CUSTOM && <input className="input mt-2 py-2" dir="auto" translate="no" autoComplete="off" aria-label={t("وصف المدة")} placeholder={t("اكتب المدة أو شرط انتهائها")} value={v.durCustom} onChange={e => dur({ durCustom: e.target.value })} />}
                    {errorText("duration")}
                  </div>
                </div>
              )}

              {isFree && medicationHasStructuredValues(m) && (
                <p className="mt-2 text-xs text-slate-700">{t("قيم الحقول المنظمة محفوظة ولن تُطبع في نمط التعليمات الحرة.")}</p>
              )}

              {showInstr ? (
                <label className="mt-2 block">
                  <span className={labelCls}>{isFree ? t("تعليمات الاستخدام الكاملة") : <>{t("تعليمات إضافية")} <span className="font-normal text-slate-600">({t("اختياري")})</span></>}</span>
                  <input id={fieldId("instructions")} className="input py-2" dir="auto" translate="no" autoComplete="off" spellCheck={false} data-field="instructions" value={m.instructions} onChange={setText("instructions")} aria-invalid={Boolean(err?.instructions)} aria-describedby={describe("instructions")} />
                  {isFree && <span className="mt-1 block text-xs text-slate-700">{t("اكتب طريقة الاستخدام كاملة، بما يناسب الدواء والحالة. لا يتحقق النظام من ملاءمتها الطبية.")}</span>}
                  {errorText("instructions")}
                </label>
              ) : (
                <button type="button" onClick={() => setInstrOpen(toggle(instrOpen, m.id, true))} className={clsx("mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary-800 hover:bg-primary-50", focus)}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> {t("إضافة تعليمات")}
                </button>
              )}

              {summary && (
                <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800" aria-live="polite">
                  <span className="font-semibold">{t("سيُطبع هكذا")}:</span> <bdi dir="auto" translate="no">{summary}</bdi>
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {removed && (
        <div role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="min-w-0 flex-1">{t("تم حذف دواء.")}</span>
          <button type="button" onClick={restore} className={clsx("inline-flex min-h-11 items-center gap-1 rounded-lg px-3 font-semibold text-amber-900 hover:bg-amber-100", focus)}>
            <Undo2 className="h-4 w-4" aria-hidden="true" /> {t("تراجع")}
          </button>
          <button type="button" onClick={() => setRemoved(null)} className={clsx("flex h-11 w-11 items-center justify-center rounded-lg hover:bg-amber-100", focus)} aria-label={t("إغلاق")}><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      )}

      <Button type="button" variant="outline" className="mt-2" onClick={addAndFocus}>
        <Plus className="h-4 w-4" aria-hidden="true" /> {t("إضافة دواء")}
      </Button>
    </div>
  );
}
