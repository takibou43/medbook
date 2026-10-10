import { useEffect, useId, useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Eye, FileText, Plus, RotateCcw, X, UserRound } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Appointment } from "../../types";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/States";
import { algeriaToday } from "../../lib/doctorUi";
import { beneficiaryName } from "../../lib/appointmentPeople";
import {
  draftHasContent, emptyDraft, getStoredDraft, newMedication, prescriptionPatientFrom, shouldAutoRebind, storeDraft, validateDraft,
  type PrescriptionDraft, type PrescriptionMedication,
} from "../../lib/prescription";
import { PrescriptionPreview, type PrescriptionSheetData } from "./PrescriptionPrint";

// بلا أمثلة جرعات في placeholder عمدًا: لا اقتراحات دوائية ولا جرعات تلقائية — كل شيء يكتبه الطبيب.
const MED_FIELDS: { key: keyof Omit<PrescriptionMedication, "id">; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "name", label: "اسم الدواء", wide: true },
  { key: "dose", label: "الجرعة" },
  { key: "frequency", label: "عدد مرات الاستخدام" },
  { key: "duration", label: "مدة العلاج" },
  { key: "instructions", label: "تعليمات إضافية", placeholder: "اختياري", wide: true },
];

const DISCARD_MSG = (name: string) => `لديك وصفة غير مطبوعة لـ «${name}» لم تُحفظ. ستُحذف هذه المسودة نهائيًا. هل تريد المتابعة؟`;

/**
 * «كتابة وصفة» في الرئيسية (مكان «جدول اليوم» سابقًا).
 * - تُربط تلقائيًا بالمريض في الاستشارة الحالية؛ بدونها يختار الطبيب موعدًا قائمًا (لا اختيار تلقائي).
 * - المسودة لمريض واحد فقط ولا تنتقل لغيره؛ تغيير المريض بمسودة مكتوبة يتطلب تأكيدًا.
 * - لا حفظ في الخادم ولا تغيير لحالة الموعد ولا إرسال أي شيء: الكتابة والطباعة محلية فقط.
 */
export function PrescriptionCard({
  current,
  appointments,
  loading,
  error,
}: {
  current: Appointment | null;
  appointments: Appointment[];
  loading: boolean;
  error: boolean;
}) {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const formId = useId();
  const [draft, setDraftState] = useState<PrescriptionDraft | null>(() => getStoredDraft(uid));
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<PrescriptionSheetData | null>(null);

  const setDraft = (d: PrescriptionDraft | null) => {
    storeDraft(d);
    setDraftState(d);
    setErrors([]);
  };
  const patch = (p: Partial<PrescriptionDraft>) => draft && setDraft({ ...draft, ...p });

  // حساب آخر على نفس الجهاز: لا تُعرض مسودته.
  useEffect(() => {
    if (draft && draft.ownerUserId !== uid) setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // الربط التلقائي بالاستشارة الحالية (فقط حين لا يضيع شيء ولا يُلغى اختيار يدوي).
  useEffect(() => {
    if (!uid || picking || !current) return;
    if (shouldAutoRebind(draft, current.id)) setDraft(emptyDraft(uid, prescriptionPatientFrom(current), "current"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, uid, picking]);

  // تنبيه المتصفح قبل إغلاق/تحديث الصفحة بمسودة مكتوبة (الحفظ غير متاح حاليًا).
  const dirty = draftHasContent(draft);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const choices = useMemo(
    () => appointments.filter((a) => a.status !== "CANCELLED").sort((x, y) => x.startTime.localeCompare(y.startTime) || x.id.localeCompare(y.id)),
    [appointments]
  );

  function confirmDiscard(): boolean {
    if (!draft || !draftHasContent(draft)) return true;
    return window.confirm(DISCARD_MSG(draft.patientName || draft.patient.bookedName));
  }

  function changePatient() {
    if (!confirmDiscard()) return;
    setDraft(null);
    setPicking(true);
  }

  function choose(appointmentId: string) {
    const a = choices.find((c) => c.id === appointmentId);
    if (!a) return;
    setDraft(emptyDraft(uid, prescriptionPatientFrom(a), current?.id === a.id ? "current" : "manual"));
    setPicking(false);
  }

  function startForCurrent() {
    if (!current || !confirmDiscard()) return;
    setPicking(false);
    setDraft(emptyDraft(uid, prescriptionPatientFrom(current), "current"));
  }

  function clearAll() {
    if (!draft || !confirmDiscard()) return;
    setDraft({ ...emptyDraft(uid, draft.patient, draft.source) });
  }

  function updateMed(id: string, key: keyof PrescriptionMedication, value: string) {
    if (!draft) return;
    patch({ medications: draft.medications.map((m) => (m.id === id ? { ...m, [key]: value } : m)) });
  }

  function removeMed(id: string) {
    if (!draft) return;
    const rest = draft.medications.filter((m) => m.id !== id);
    patch({ medications: rest.length ? rest : [newMedication()] });
  }

  function openPreview() {
    if (!draft) return;
    const v = validateDraft(draft);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors([]);
    setPreview({
      doctor: user?.doctor,
      patientName: draft.patientName.trim(),
      day: algeriaToday(),
      medications: v.printable,
      notes: draft.notes,
    });
  }

  const draftIsCurrent = Boolean(draft && current && draft.patient.appointmentId === current.id);
  const currentChanged = Boolean(draft && current && !draftIsCurrent && draftHasContent(draft));
  const nameEdited = Boolean(draft && draft.patientName.trim() !== draft.patient.bookedName.trim());

  return (
    <section className="card p-4 sm:p-5" aria-labelledby={`${formId}-title`}>
      <PrescriptionPreview open={Boolean(preview)} data={preview} onClose={() => setPreview(null)} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id={`${formId}-title`} className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <FileText className="h-5 w-5 text-primary-600" aria-hidden="true" /> كتابة وصفة
          </h2>
          {draft && (
            <span className={clsx("badge", dirty ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")} title="الوصفة لا تُحفظ في النظام">
              {dirty ? "مسودة غير محفوظة" : "فارغة"}
            </span>
          )}
        </div>
        {draft && (
          <button type="button" onClick={changePatient} className="text-sm font-semibold text-primary-700 underline-offset-2 hover:underline">
            تغيير المريض
          </button>
        )}
      </div>

      {currentChanged && current && draft && (
        <div role="alert" className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              المريض في الاستشارة الآن هو <b>{beneficiaryName(current)}</b>، وهذه المسودة تخص <b>{draft.patient.bookedName}</b>.
            </span>
          </p>
          <Button variant="outline" onClick={startForCurrent}>بدء وصفة لـ{beneficiaryName(current)}</Button>
        </div>
      )}

      {!draft ? (
        <div className="mt-3">
          {loading ? (
            <div className="py-6"><Spinner /></div>
          ) : error ? (
            <p role="alert" className="text-sm text-red-700">تعذّر تحميل مواعيد اليوم لاختيار المريض.</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                {current ? "اختر المريض الذي تكتب له الوصفة." : "لا توجد استشارة حالية. اختر موعدًا قائمًا لتحديد المريض."}
              </p>
              {choices.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-50 p-4 text-center text-slate-600">لا توجد مواعيد اليوم لاختيار مريض.</p>
              ) : (
                <label className="mt-3 block">
                  <span className="label">الموعد</span>
                  <select className="input" value="" onChange={(e) => choose(e.target.value)}>
                    <option value="" disabled>اختر موعدًا…</option>
                    {choices.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.startTime} — {beneficiaryName(a)}{current?.id === a.id ? " (الاستشارة الحالية)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {picking && current && (
                <button type="button" onClick={() => choose(current.id)} className="mt-2 text-sm font-semibold text-primary-700 hover:underline">
                  الرجوع إلى المريض الحالي
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <form
          className="mt-3 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            openPreview();
          }}
          aria-describedby={`${formId}-note`}
        >
          {/* المريض */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 sm:p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <UserRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
              {draftIsCurrent ? <span className="badge bg-sky-100 text-sky-700">الاستشارة الحالية</span> : <span className="badge bg-slate-200 text-slate-700">موعد مختار</span>}
              <span>موعد <span className="tabular-nums">{draft.patient.startTime}</span></span>
              {draft.patient.relationship && (
                <span className="badge border border-primary-200 bg-primary-50 text-primary-800">
                  {draft.patient.relationship}{draft.patient.accountHolderName ? ` — حساب ${draft.patient.accountHolderName}` : ""}
                </span>
              )}
            </div>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">اسم المريض على الوصفة</span>
              <input
                className="input py-2 text-base font-bold"
                value={draft.patientName}
                onChange={(e) => patch({ patientName: e.target.value })}
                autoComplete="off"
              />
            </label>
            {nameEdited && (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                عُدّل الاسم للوصفة فقط — لا يتغيّر ملف المريض ولا الحجز.
                <button type="button" onClick={() => patch({ patientName: draft.patient.bookedName })} className="inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline">
                  <RotateCcw className="h-3 w-3" aria-hidden="true" /> الاسم الأصلي
                </button>
              </p>
            )}
          </div>

          {/* الأدوية: الاسم بعرض كامل، ثم الجرعة/التكرار/المدة في صف (عمود واحد على الهاتف)، ثم التعليمات */}
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-slate-800">الأدوية ({draft.medications.length})</legend>
            <ol className="divide-y divide-slate-200 rounded-xl border border-slate-200">
              {draft.medications.map((m, i) => (
                <li key={m.id} className="p-2.5 sm:p-3" role="group" aria-label={`الدواء رقم ${i + 1}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-6 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-700" aria-hidden="true">{i + 1}</span>
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                      {MED_FIELDS.map((f) => (
                        <label key={f.key} className={clsx("block min-w-0", f.wide && "sm:col-span-3")}>
                          <span className="mb-0.5 block text-xs font-medium text-slate-600">{f.label}</span>
                          <input
                            className={clsx("input py-2", f.key === "name" && "font-semibold")}
                            dir="auto"
                            value={m[f.key]}
                            placeholder={f.placeholder}
                            onChange={(e) => updateMed(m.id, f.key, e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            data-field={f.key}
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMed(m.id)}
                      className="mt-5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700"
                      aria-label={`حذف الدواء رقم ${i + 1}`}
                      title="حذف الدواء"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <Button type="button" variant="outline" className="mt-2" onClick={() => patch({ medications: [...draft.medications, newMedication()] })}>
              <Plus className="h-4 w-4" aria-hidden="true" /> إضافة دواء
            </Button>
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-sm font-bold text-slate-800">ملاحظات عامة <span className="font-normal text-slate-500">(اختياري)</span></span>
            <textarea className="input min-h-[64px]" dir="auto" value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </label>

          {errors.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <Button type="submit" className="flex-1 sm:flex-none">
              <Eye className="h-4 w-4" aria-hidden="true" /> معاينة وطباعة
            </Button>
            <button type="button" onClick={clearAll} disabled={!dirty} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-red-700 disabled:opacity-40">
              مسح الوصفة
            </button>
          </div>
          <p id={`${formId}-note`} className="text-xs text-slate-500">لا تُحفظ ولا تُرسل للمريض — تُطبع فقط.</p>
        </form>
      )}
    </section>
  );
}
