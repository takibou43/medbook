import { useEffect, useId, useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Eye, FileText, RotateCcw, UserRound } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Appointment } from "../../types";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/States";
import { algeriaToday } from "../../lib/doctorUi";
import { beneficiaryName } from "../../lib/appointmentPeople";
import {
  draftHasContent, emptyDraft, restoreMedication, getStoredDraft, newMedication, prescriptionPatientFrom, shouldAutoRebind, storeDraft, validateDraft, samePrescriptionVisit, prescriptionVisitLabel,
  type PrescriptionDraft, type DraftValidation,
} from "../../lib/prescription";
import { PrescriptionPreview, type PrescriptionSheetData } from "./PrescriptionPrint";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { Link } from "react-router-dom";
import { usePrescriptionSetup } from "../../hooks/usePrescriptionSetup";
import { RequestItems } from "./RequestItems";
import { readPatientLatinName, rememberPatientLatinName, forgetPatientLatinName, validLatinPatientName } from "../../lib/prescriptionPatientNames";
import { useToast } from "../ui/Toast";
import { MedicationList } from "./MedicationFields";


const DISCARD_MSG = (name: string) => t("لديك وصفة غير مطبوعة لـ «{name}» لم تُحفظ. ستُحذف هذه المسودة نهائيًا. هل تريد المتابعة؟", { name });

/**
 * «كتابة وصفة» في الرئيسية (مكان «جدول اليوم» سابقًا).
 * - تُربط تلقائيًا بالمريض في الاستشارة الحالية؛ بدونها يختار الطبيب موعدًا قائمًا (لا اختيار تلقائي).
 * - المسودة لمريض واحد فقط ولا تنتقل لغيره؛ تغيير المريض بمسودة مكتوبة يتطلب تأكيدًا.
 * - لا حفظ في الخادم ولا تغيير لحالة الموعد ولا إرسال أي شيء: الكتابة والطباعة محلية فقط.
 */
function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">{n}</span>
      <span className="text-sm font-bold text-slate-800">{title}</span>
      {hint && <span className="text-xs text-slate-500">({hint})</span>}
    </div>
  );
}

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
  const { showToast } = useToast();
  const [draft, setDraftState] = useState<PrescriptionDraft | null>(() => getStoredDraft(uid));
  const [errors, setErrors] = useState<string[]>([]);
  const [validation, setValidation] = useState<DraftValidation | null>(null);
  const [preview, setPreview] = useState<PrescriptionSheetData | null>(null);
  // لغة الوصفة والقالب والبيانات المهنية تأتي من إعدادات الطبيب المحفوظة (صفحة إعدادات الحساب) لا من هذه الصفحة.
  const setup = usePrescriptionSetup(uid);
  const lang = setup.settings?.language ?? "ar";
  const [listKey, setListKey] = useState(0);
  const [frOpen, setFrOpen] = useState(false);

  const setDraft = (d: PrescriptionDraft | null) => {
    storeDraft(d);
    setDraftState(d);
    setErrors([]);
    setValidation(null);
  };
  const withLatinName = (d: PrescriptionDraft): PrescriptionDraft => ({ ...d, patientNameFr: readPatientLatinName(uid, d.patient) });
  // أي تعديل بعد الطباعة يُلغي علامة «مطبوعة»: النسخة المعدّلة لم تُطبع بعد، فلا تُستبدل تلقائيًا.
  const patch = (p: Partial<PrescriptionDraft>) => draft && setDraft({ ...draft, ...p, printedAt: undefined });
  const markPrinted = () => { if (draft) setDraft({ ...draft, printedAt: new Date().toISOString() }); };

  // حساب آخر على نفس الجهاز: لا تُعرض مسودته.
  useEffect(() => {
    if (draft && draft.ownerUserId !== uid) setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // الربط التلقائي بالاستشارة الحالية (فقط حين لا يضيع شيء ولا يُلغى اختيار يدوي).
  useEffect(() => {
    if (!uid || !current) return;
    if (shouldAutoRebind(draft, current.id)) setDraft(withLatinName(emptyDraft(uid, prescriptionPatientFrom(current), "current")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, uid]);

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

  function choose(appointmentId: string) {
    const a = choices.find((c) => c.id === appointmentId);
    if (!a) return;
    setDraft(withLatinName(emptyDraft(uid, prescriptionPatientFrom(a), current?.id === a.id ? "current" : "manual")));
  }

  function startForCurrent() {
    if (!current || !confirmDiscard()) return;
    setDraft(withLatinName(emptyDraft(uid, prescriptionPatientFrom(current), "current")));
  }

  function clearAll() {
    if (!draft || !confirmDiscard()) return;
    setDraft({ ...emptyDraft(uid, draft.patient, draft.source) });
    setListKey((k) => k + 1);
  }

  function removeMed(id: string) {
    if (!draft) return;
    const rest = draft.medications.filter((m) => m.id !== id);
    patch({ medications: rest.length ? rest : [newMedication("freeText")] });
  }

  function openPreview() {
    if (!draft || setup.loading || !setup.settings) return;
    if (lang === "fr" && draft.patientNameFr?.trim() && !validLatinPatientName(draft.patientNameFr)) { setErrors([t("راجع اسم المريض بالفرنسية: استعمل الحروف اللاتينية فقط.")]); return; }
    const v = validateDraft(draft);
    setValidation(v);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors([]);
    setPreview({
      template: setup.template,
      doctor: user?.doctor,
      language: setup.settings.language,
      headerLanguage: setup.settings.headerLanguage,
      professional: setup.settings.professional[setup.settings.language],
      doctorNames: { ar: setup.settings.professional.ar?.doctorName, fr: setup.settings.professional.fr?.doctorName },
      addresses: { ar: setup.settings.professional.ar?.address, fr: setup.settings.professional.fr?.address },
      clinicNames: { ar: setup.settings.professional.ar?.clinicName, fr: setup.settings.professional.fr?.clinicName },
      show: setup.settings.show,
      labs: v.labs,
      imaging: v.imaging,
      patientName: lang === "fr" && draft.patientNameFr?.trim() ? draft.patientNameFr.trim() : draft.patientName.trim(),
      patientAge: draft.patientAge,
      patientAgeUnit: draft.patientAgeUnit,
      patientWeight: draft.patientWeight,
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
      <PrescriptionPreview open={Boolean(preview)} data={preview} onClose={() => setPreview(null)} onPrinted={markPrinted} />

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
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-600" role={setup.error ? "alert" : "status"}>
        {setup.loading ? t("جارٍ تحميل إعدادات الوصفة…") : setup.error || !setup.settings ? (
          <>
            <span className="text-amber-800">{t("تعذّر تحميل إعدادات الوصفة. لا يمكن المعاينة قبل تحميلها.")}</span>
            <button type="button" className="min-h-11 px-2 font-semibold text-primary-700 hover:underline" onClick={setup.refetch}>{t("إعادة المحاولة")}</button>
          </>
        ) : (
          <>
            <span>{t("لغة الوصفة:")} <bdi>{setup.settings.language === "fr" ? "Français" : "العربية"}</bdi>{setup.template ? ` · ${t("قالبك الشخصي مفعّل")}` : ""}</span>
            <Link to="/account" className="inline-flex min-h-11 items-center font-semibold text-primary-700 hover:underline">{t("تغيير إعدادات الوصفة")}</Link>
          </>
        )}
      </p>

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
          {/* ① المريض */}
          <div>
            <Step n={1} title={t("المريض")} />
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem]">
                <label className="col-span-2 block min-w-0 sm:col-span-1">
                  <span className="mb-1 block text-xs font-semibold text-slate-700">{t("اسم المريض على الوصفة")}</span>
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
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-semibold text-slate-700">{t("العمر")} <span className="font-normal text-slate-500">({t("اختياري")})</span></span>
                  <input className="input py-2 text-center" type="number" min="0" step="1" max="150" placeholder={t("سنة")} value={draft.patientAge ?? ""} onChange={e => patch({ patientAge: e.target.value, patientAgeUnit: "years" })} autoComplete="off" />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-semibold text-slate-700">{t("الوزن")} <span className="font-normal text-slate-500">({t("اختياري")})</span></span>
                  <input className="input py-2 text-center" type="text" inputMode="decimal" maxLength={5} placeholder={t("كغ")} value={draft.patientWeight ?? ""} onChange={e => patch({ patientWeight: e.target.value })} autoComplete="off" />
                </label>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                {draftIsCurrent ? <span className="badge bg-sky-100 text-sky-700">{t("الاستشارة الحالية")}</span> : <span className="badge bg-slate-200 text-slate-700">{t("موعد مختار")}</span>}
                <span>{t("موعد")} <bdi dir="ltr" className="tabular-nums">{draft.patient.startTime}</bdi></span>
                {draft.patient.relationship && (
                  <span className="badge border border-primary-200 bg-primary-50 text-primary-800">
                    {t(draft.patient.relationship)}{draft.patient.accountHolderName ? ` — ${t("حساب {name}", { name: draft.patient.accountHolderName })}` : ""}
                  </span>
                )}
                {nameEdited && (
                  <button type="button" onClick={() => patch({ patientName: draft.patient.bookedName })} className="inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline" title={t("عُدّل الاسم للوصفة فقط — لا يتغيّر ملف المريض ولا الحجز.")}>
                    <RotateCcw className="h-3 w-3" aria-hidden="true" /> {t("الاسم الأصلي")}
                  </button>
                )}
                {!(frOpen || lang === "fr" || (draft.patientNameFr ?? "").trim()) && (
                  <button type="button" onClick={() => setFrOpen(true)} className="ms-auto font-semibold text-primary-700 hover:underline">{t("+ الاسم بالفرنسية")}</button>
                )}
              </div>

              {/* الاسم بالفرنسية: يظهر عند الطلب أو تلقائيًا إن كانت لغة الوصفة فرنسية. */}
              {(frOpen || lang === "fr" || (draft.patientNameFr ?? "").trim()) && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-700">{t("اسم المريض بالفرنسية (اختياري)")}</span>
                    <input className="input py-2" dir="ltr" lang="fr" translate="no" autoComplete="off" maxLength={160} placeholder="Ex. : Karim Ayachi" value={draft.patientNameFr ?? ""} onChange={e => patch({ patientNameFr: e.target.value })} />
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                    <span className="text-slate-500">{t("للوصفة الفرنسية فقط.")}</span>
                    <button type="button" disabled={!validLatinPatientName(draft.patientNameFr ?? "")} className="min-h-8 font-semibold text-primary-700 hover:underline disabled:opacity-40" onClick={() => { const ok = rememberPatientLatinName(uid, draft.patient, draft.patientNameFr ?? ""); showToast(ok ? t("حُفظ الاسم لهذا المريض على هذا الجهاز لمدة 90 يومًا.") : t("تعذّر حفظ الاسم على هذا الجهاز."), ok ? "success" : "error"); }}>{t("تذكّر الاسم على هذا الجهاز")}</button>
                    <button type="button" className="min-h-8 font-semibold text-slate-600 hover:underline" onClick={() => { const ok = forgetPatientLatinName(uid, draft.patient); if (ok) patch({ patientNameFr: "" }); showToast(ok ? t("أُلغي تذكّر الاسم على هذا الجهاز.") : t("تعذّر حفظ التغيير."), ok ? "info" : "error"); }}>{t("إلغاء تذكّر الاسم")}</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ② الأدوية */}
          <fieldset>
            <legend className="w-full"><Step n={2} title={t("الأدوية")} hint={String(draft.medications.length)} /></legend>
            <MedicationList
              key={`${draft.patient.appointmentId}-${listKey}`}
              medications={draft.medications}
              ownerUserId={uid}
              lang={lang}
              errors={validation?.medicationErrors ?? {}}
              formId={formId}
              onUpdate={(id, p) => draft && patch({ medications: draft.medications.map((m) => (m.id === id ? { ...m, ...p } : m)) })}
              onRemove={removeMed}
              onRestore={(med, index) => draft && patch({ medications: restoreMedication(draft.medications, med, index) })}
              onAdd={() => patch({ medications: [...draft.medications, newMedication("freeText")] })}
            />
          </fieldset>

          {/* ③ تحاليل وأشعة — اختيارية ومطوية حتى تُفتح */}
          <div>
            <Step n={3} title={t("تحاليل وأشعة")} hint={t("اختياري")} />
            <div className="space-y-2">
          <RequestItems kind="labs" title={t("التحاليل الطبية")} addLabel={t("إضافة تحليل")} items={draft.labs ?? []} errors={validation?.requestErrors} onChange={labs => patch({ labs })} />
          <RequestItems kind="imaging" title={t("الأشعة والفحوصات")} addLabel={t("إضافة أشعة أو فحص")} items={draft.imaging ?? []} errors={validation?.requestErrors} onChange={imaging => patch({ imaging })} />
            </div>
          </div>

          {/* ④ ملاحظات */}
          <label className="block">
            <Step n={4} title={t("ملاحظات عامة")} hint={t("اختياري")} />
            <textarea className="input min-h-[64px]" dir="auto" placeholder={t("مثال: الراحة وشرب الماء بكثرة")} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </label>

          {errors.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {errors.map((e) => {
                const medication = /^الدواء رقم (\d+): (.+)$/.exec(e);
                const request = /^(التحاليل|الأشعة والفحوصات) رقم (\d+): (.+)$/.exec(e);
                return <li key={e}>{medication ? `${t("الدواء رقم {n}", { n: medication[1] })}: ${t(medication[2])}` : request ? `${t(request[1])} ${request[2]}: ${t(request[3])}` : t(e)}</li>;
              })}
            </ul>
          )}

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:-mx-5 sm:px-5" data-testid="rx-actions">
            <Button type="submit" className="flex-1 sm:flex-none" disabled={setup.loading || !setup.settings}>
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
