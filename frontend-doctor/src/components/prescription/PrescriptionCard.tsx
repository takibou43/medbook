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
  draftHasContent, emptyDraft, getStoredDraft, newMedication, prescriptionPatientFrom, shouldAutoRebind, storeDraft, validateDraft, samePrescriptionVisit, prescriptionVisitLabel,
  type PrescriptionDraft, type PrescriptionMedication, type DraftValidation,
} from "../../lib/prescription";
import { PrescriptionPreview, type PrescriptionSheetData } from "./PrescriptionPrint";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { api } from "../../lib/api";
import type { PrescriptionTemplate } from "../../lib/prescriptionTemplate";
import { PrescriptionTemplateEditor } from "./PrescriptionTemplateEditor";

// بلا أمثلة جرعات في placeholder عمدًا: لا اقتراحات دوائية ولا جرعات تلقائية — كل شيء يكتبه الطبيب.
const MED_FIELDS: { key: keyof Omit<PrescriptionMedication, "id" | "directionsMode">; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "name", label: "اسم الدواء", wide: true },
  { key: "dose", label: "الجرعة" },
  { key: "frequency", label: "عدد مرات الاستخدام" },
  { key: "duration", label: "مدة العلاج" },
  { key: "instructions", label: "تعليمات إضافية", placeholder: "اختياري", wide: true },
];

const DISCARD_MSG = (name: string) => t("لديك وصفة غير مطبوعة لـ «{name}» لم تُحفظ. ستُحذف هذه المسودة نهائيًا. هل تريد المتابعة؟", { name });

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
  useLanguage();
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const formId = useId();
  const [draft, setDraftState] = useState<PrescriptionDraft | null>(() => getStoredDraft(uid));
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [validation, setValidation] = useState<DraftValidation | null>(null);
  const [preview, setPreview] = useState<PrescriptionSheetData | null>(null);
  const [template, setTemplate] = useState<PrescriptionTemplate | null>(null);
  const [templateError, setTemplateError] = useState(false);
  useEffect(() => {
    let active = true;
    setTemplate(null); setTemplateError(false);
    if (uid) api.get("/doctor/prescription-template").then(res => { if (active) setTemplate(res.data.data); }).catch(() => { if (active) setTemplateError(true); });
    return () => { active = false; };
  }, [uid]);

  const setDraft = (d: PrescriptionDraft | null) => {
    storeDraft(d);
    setDraftState(d);
    setErrors([]);
    setValidation(null);
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
    setValidation(v);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors([]);
    setPreview({
      template,
      doctor: user?.doctor,
      language: draft.printLanguage ?? "ar",
      professional: draft.professional?.[draft.printLanguage ?? "ar"],
      patientName: draft.patientName.trim(),
      day: algeriaToday(),
      medications: v.printable,
      notes: draft.notes,
    });
  }

  const draftIsCurrent = Boolean(draft && current && samePrescriptionVisit(draft.patient, current));
  const currentChanged = Boolean(draft && current && !draftIsCurrent && draftHasContent(draft));
  const nameEdited = Boolean(draft && draft.patientName.trim() !== draft.patient.bookedName.trim());

  return (
    <section className="card p-4 sm:p-5" aria-labelledby={`${formId}-title`}>
      <PrescriptionPreview open={Boolean(preview)} data={preview} onClose={() => setPreview(null)} />
      {templateError && <p role="alert" className="text-sm text-amber-800">{t("تعذر تحميل قالب الوصفة. أعد تحميل الصفحة للمحاولة مجددًا.")}</p>}
      {!templateError && <PrescriptionTemplateEditor key={uid} value={template} onChange={setTemplate} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id={`${formId}-title`} className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <FileText className="h-5 w-5 text-primary-600" aria-hidden="true" /> {t("كتابة وصفة")}
          </h2>
          {draft && (
            <span className={clsx("badge", dirty ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")} title={t("الوصفة لا تُحفظ في النظام")}>
              {dirty ? t("مسودة غير محفوظة") : t("فارغة")}
            </span>
          )}
        </div>
        {draft && (
          <button type="button" onClick={changePatient} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary-400">
            {t("تغيير المريض")}
          </button>
        )}
      </div>

      {currentChanged && current && draft && (
        <div role="alert" className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {t("المسودة مرتبطة بزيارة أخرى. لم تُنقل بياناتها إلى الاستشارة الحالية.")}
              <span className="mt-1 block">{t("زيارة المسودة:")} <bdi>{prescriptionVisitLabel(draft.patient)}</bdi></span>
              <span className="mt-1 block">{t("الزيارة الحالية:")} <bdi>{prescriptionVisitLabel(prescriptionPatientFrom(current))}</bdi></span>
            </span>
          </p>
          <Button variant="outline" onClick={startForCurrent}>{t("إنشاء وصفة جديدة للزيارة الحالية")}</Button>
        </div>
      )}

      {!draft ? (
        <div className="mt-3">
          {loading ? (
            <div className="py-6"><Spinner /></div>
          ) : error ? (
            <p role="alert" className="text-sm text-red-700">{t("تعذّر تحميل مواعيد اليوم لاختيار المريض.")}</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                {current ? t("اختر المريض الذي تكتب له الوصفة.") : t("لا توجد استشارة حالية. اختر موعدًا قائمًا لتحديد المريض.")}
              </p>
              {choices.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-50 p-4 text-center text-slate-600">{t("لا توجد مواعيد اليوم لاختيار مريض.")}</p>
              ) : (
                <label className="mt-3 block">
                  <span className="label">{t("الموعد")}</span>
                  <select className="input" value="" onChange={(e) => choose(e.target.value)}>
                    <option value="" disabled>{t("اختر موعدًا…")}</option>
                    {choices.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.startTime} — {beneficiaryName(a)}{current?.id === a.id ? ` (${t("الاستشارة الحالية")})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {picking && current && (
                <button type="button" onClick={() => choose(current.id)} className="mt-2 inline-flex min-h-11 items-center px-2 text-sm font-semibold text-primary-700 hover:underline">
                  {t("الرجوع إلى المريض الحالي")}
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
          <label className="block">
            <span className="label">{t("لغة الوصفة والطباعة")}</span>
            <select className="input" value={draft.printLanguage ?? "ar"} onChange={e => patch({ printLanguage: e.target.value === "fr" ? "fr" : "ar" })}>
              <option value="ar">العربية</option><option value="fr">Français</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">{t("تغيير لغة الوصفة لا يغيّر لغة لوحة الطبيب أو النصوص التي كتبتها.")}</span>
          </label>
          <details className="rounded-xl border border-slate-200 p-3">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">{t("بيانات مهنية اختيارية لهذه الوصفة")}</summary>
            <p className="my-2 text-xs text-slate-600">{t("تُطبق على لغة الوصفة المختارة فقط. اترك الحقول فارغة لاستخدام البيانات الأصلية. لا تُحفظ في الملف المهني ولا تُترجم الأسماء تلقائيًا.")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {([{ key: "doctorName", label: "اسم الطبيب للطباعة" }, { key: "clinicName", label: "اسم العيادة للطباعة" }, { key: "address", label: "العنوان للطباعة" }] as const).map(field => (
                <label key={field.key} className="block text-xs">
                  <span className="mb-1 block">{t(field.label)}</span>
                  <input className="input" dir="auto" translate="no" value={draft.professional?.[draft.printLanguage ?? "ar"]?.[field.key] ?? ""} onChange={e => {
                    const lang = draft.printLanguage ?? "ar";
                    patch({ professional: { ...draft.professional, [lang]: { ...draft.professional?.[lang], [field.key]: e.target.value } } });
                  }} />
                </label>
              ))}
            </div>
          </details>
          {/* المريض */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 sm:p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <UserRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
              {draftIsCurrent ? <span className="badge bg-sky-100 text-sky-700">{t("الاستشارة الحالية")}</span> : <span className="badge bg-slate-200 text-slate-700">{t("موعد مختار")}</span>}
              <span>{t("موعد")} <span className="tabular-nums">{draft.patient.appointmentDate.slice(0, 10)} — {draft.patient.startTime}</span></span>
              {draft.patient.relationship && (
                <span className="badge border border-primary-200 bg-primary-50 text-primary-800">
                  {t(draft.patient.relationship)}{draft.patient.accountHolderName ? ` — ${t("حساب {name}", { name: draft.patient.accountHolderName })}` : ""}
                </span>
              )}
            </div>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("اسم المريض على الوصفة")}</span>
              <input
                className="input py-2 text-base font-bold"
                dir="auto"
                translate="no"
                value={draft.patientName}
                onChange={(e) => patch({ patientName: e.target.value })}
                autoComplete="off"
                aria-invalid={Boolean(errors.length && !draft.patientName.trim())}
                aria-describedby={errors.length && !draft.patientName.trim() ? formId + '-patient-error' : undefined}
              />
              {errors.length > 0 && !draft.patientName.trim() && <span id={formId + '-patient-error'} className="block text-sm text-red-700">{t("اكتب اسم المريض.")}</span>}
            </label>
            {nameEdited && (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {t("عُدّل الاسم للوصفة فقط — لا يتغيّر ملف المريض ولا الحجز.")}
                <button type="button" onClick={() => patch({ patientName: draft.patient.bookedName })} className="inline-flex min-h-11 items-center gap-1 px-2 font-semibold text-primary-700 hover:underline">
                  <RotateCcw className="h-3 w-3" aria-hidden="true" /> {t("الاسم الأصلي")}
                </button>
              </p>
            )}
          </div>

          {/* الأدوية: الاسم بعرض كامل، ثم الجرعة/التكرار/المدة في صف (عمود واحد على الهاتف)، ثم التعليمات */}
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-slate-800">{t("الأدوية")} ({draft.medications.length})</legend>
            <ol className="divide-y divide-slate-200 rounded-xl border border-slate-200">
              {draft.medications.map((m, i) => (
                <li key={m.id} className="p-2.5 sm:p-3" role="group" aria-label={t("الدواء رقم {n}", { n: i + 1 })}>
                  <div className="flex items-start gap-2">
                    <span className="mt-6 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-700" aria-hidden="true">{i + 1}</span>
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="block text-xs sm:col-span-3">
                        <span className="mb-1 block">{t("طريقة كتابة تعليمات الدواء")}</span>
                        <select className="input" value={m.directionsMode ?? "structured"} onChange={e => updateMed(m.id, "directionsMode", e.target.value)}>
                          <option value="structured">{t("جرعة وتكرار ومدة")}</option>
                          <option value="freeText">{t("تعليمات حرة مكتملة لحالة خاصة")}</option>
                        </select>
                        {m.directionsMode === "freeText" && <span className="mt-1 block text-slate-600">{t("اكتب طريقة الاستخدام كاملة، بما يناسب الدواء والحالة. لا يتحقق النظام من ملاءمتها الطبية.")}</span>}
                      </label>
                      {MED_FIELDS.map((f) => (
                        <label key={f.key} className={clsx("block min-w-0", f.wide && "sm:col-span-3")}>
                          <span className="mb-0.5 block text-xs font-medium text-slate-600">{t(f.label)}{m.directionsMode === "freeText" && ["dose", "frequency", "duration"].includes(f.key) ? ` (${t("اختياري")})` : ""}</span>
                          <input
                            className={clsx("input py-2", f.key === "name" && "font-semibold")}
                            dir="auto"
                            value={m[f.key]}
                            placeholder={f.key === "instructions" && m.directionsMode === "freeText" ? undefined : f.placeholder ? t(f.placeholder) : undefined}
                            onChange={(e) => updateMed(m.id, f.key, e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            translate="no"
                            data-field={f.key}
                            aria-invalid={Boolean(validation?.medicationErrors[m.id]?.[f.key])}
                            aria-describedby={validation?.medicationErrors[m.id]?.[f.key] ? formId + m.id + f.key : undefined}
                          />
                          {validation?.medicationErrors[m.id]?.[f.key] && <span id={formId + m.id + f.key} className="mt-1 block text-xs text-red-700">{t(validation.medicationErrors[m.id][f.key]!)}</span>}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMed(m.id)}
                      className="mt-5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700"
                      aria-label={t("حذف الدواء رقم {n}", { n: i + 1 })}
                      title={t("حذف الدواء")}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <Button type="button" variant="outline" className="mt-2" onClick={() => patch({ medications: [...draft.medications, newMedication()] })}>
              <Plus className="h-4 w-4" aria-hidden="true" /> {t("إضافة دواء")}
            </Button>
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-sm font-bold text-slate-800">{t("ملاحظات عامة")} <span className="font-normal text-slate-500">({t("اختياري")})</span></span>
            <textarea className="input min-h-[64px]" dir="auto" value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </label>

          {errors.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {errors.map((e) => {
                const medication = /^الدواء رقم (\d+): (.+)$/.exec(e);
                return <li key={e}>{medication ? `${t("الدواء رقم {n}", { n: medication[1] })}: ${t(medication[2])}` : t(e)}</li>;
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <Button type="submit" className="flex-1 sm:flex-none">
              <Eye className="h-4 w-4" aria-hidden="true" /> {t("معاينة وطباعة")}
            </Button>
            <button type="button" onClick={clearAll} disabled={!dirty} className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-red-700 disabled:opacity-40">
              {t("مسح الوصفة")}
            </button>
          </div>
          <p id={`${formId}-note`} className="text-xs text-slate-500">{t("لا تُحفظ ولا تُرسل للمريض — تُطبع فقط.")}</p>
        </form>
      )}
    </section>
  );
}
