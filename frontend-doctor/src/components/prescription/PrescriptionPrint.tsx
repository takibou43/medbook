import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minus, Plus, Printer, X } from "lucide-react";
import type { Doctor } from "../../types";
import type { PrescriptionMedication } from "../../lib/prescription";
import { prescriptionLabels, prescriptionDate, prescriptionCatalogName, professionalText, type PrescriptionLanguage, type PrescriptionProfessional } from "../../lib/prescriptionPrint";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";

export interface PrescriptionSheetData {
  language: PrescriptionLanguage;
  professional?: PrescriptionProfessional;
  doctor: Doctor | null | undefined;
  /** اسم المستفيد الفعلي كما كتبه/أكّده الطبيب (لا يُطبع صاحب الحساب ولا صلة القرابة). */
  patientName: string;
  /** YYYY-MM-DD بتوقيت الجزائر. */
  day: string;
  medications: PrescriptionMedication[];
  notes: string;
}

/** نص كتبه الطبيب: يُعرض كما هو، معزول الاتجاه حتى لا تنقلب الأرقام والوحدات في النص المختلط. */
function Typed({ children, className }: { children: string; className?: string }) {
  return <bdi dir="auto" translate="no" className={className}>{children}</bdi>;
}

/**
 * ورقة الوصفة (A4) — نفس المكوّن ونفس البيانات في المعاينة والطباعة.
 * يُطبع فقط ما هو موجود فعلًا: لا شعار ولا عمر ولا رقم وصفة ولا QR ولا توقيع/ختم رقمي.
 */
export function PrescriptionSheet({ data }: { data: PrescriptionSheetData }) {
  const lang = data.language;
  const text = prescriptionLabels(lang);
  const d = data.doctor;
  const clinic = d?.clinic ?? null;
  const place = [d?.city ? prescriptionCatalogName(d.city, lang) : "", d?.wilaya ? prescriptionCatalogName(d.wilaya, lang) : ""].filter(Boolean).join(lang === "fr" ? ", " : "، ");
  const address = professionalText(data.professional?.address, clinic?.address || d?.address);
  const doctorName = professionalText(data.professional?.doctorName, d ? `${d.firstName} ${d.lastName}` : "");
  const clinicName = professionalText(data.professional?.clinicName, clinic?.nameAr);
  const phone = (clinic?.phone || d?.phone || "").trim();
  const hasContact = Boolean(address || place || phone);
  return (
    <article className="rx-sheet" dir={lang === "fr" ? "ltr" : "rtl"} lang={lang} aria-label={text.sheet}>
      <header className="rx-head">
        <div className="rx-id">
          {doctorName && <p className="rx-doctor">{text.doctor} <Typed>{doctorName}</Typed></p>}
          {d?.specialty && <p className="rx-specialty">{prescriptionCatalogName(d.specialty, lang)}</p>}
          {clinicName && <p className="rx-clinic"><Typed>{clinicName}</Typed></p>}
        </div>
        {hasContact && (
          <div className="rx-contact">
            {address && <p><Typed>{address}</Typed></p>}
            {place && <p><Typed>{place}</Typed></p>}
            {phone && <p>{text.phone} <bdi dir="ltr" translate="no">{phone}</bdi></p>}
          </div>
        )}
      </header>

      <h1 className="rx-title">{text.title}</h1>

      <dl className="rx-meta">
        <div>
          <dt>{text.patient}</dt>
          <dd className="rx-patient"><Typed>{data.patientName}</Typed></dd>
        </div>
        <div>
          <dt>{text.date}</dt>
          <dd>{prescriptionDate(data.day, lang)}</dd>
        </div>
      </dl>

      <ol className="rx-meds" aria-label={text.medications}>
        {data.medications.map((m, i) => {
          const facts = [
            { label: text.dose, value: m.dose.trim() },
            { label: text.frequency, value: m.frequency.trim() },
            { label: text.duration, value: m.duration.trim() },
          ].filter((f) => f.value);
          const instructions = m.instructions.trim();
          return (
            <li key={m.id} className="rx-med">
              <span className="rx-index" aria-hidden="true">{i + 1}</span>
              <div className="rx-med-body">
                <p className="rx-med-name"><Typed>{m.name}</Typed></p>
                {facts.length > 0 && (
                  <p className="rx-facts">
                    {facts.map((f) => (
                      <span key={f.label} className="rx-fact">
                        <span className="rx-fact-label">{f.label}:</span> <Typed>{f.value}</Typed>
                      </span>
                    ))}
                  </p>
                )}
                {instructions && (
                  <p className="rx-instructions"><span className="rx-fact-label">{text.instructions}</span> <Typed>{instructions}</Typed></p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {data.notes.trim() && (
        <section className="rx-notes">
          <h2 className="rx-small-title">{text.notes}</h2>
          <p className="rx-notes-body"><Typed>{data.notes.trim()}</Typed></p>
        </section>
      )}

      <footer className="rx-sign">
        <div className="rx-sign-area">
          <p className="rx-small-title">{text.signature}</p>
          <div className="rx-sign-line" />
        </div>
        <div className="rx-sign-area">
          <p className="rx-small-title">{text.stamp}</p>
          <div className="rx-stamp-space" />
        </div>
      </footer>
    </article>
  );
}

const PAPER_PX = 794; // 210mm بدقة 96dpi
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * معاينة قبل الطباعة: ورقة A4 بأبعادها الحقيقية مصغّرة لتلائم الشاشة (نفس الورقة على الهاتف والكمبيوتر)،
 * مع تكبير/تصغير وشريط أدوات خارج الورقة. الطباعة تُخفي كل شيء عدا الورقة (.rx-print-root في index.css)،
 * ولا تغيّر حالة أي موعد ولا ترسل شيئًا.
 */
export function PrescriptionPreview({ open, data, onClose }: { open: boolean; data: PrescriptionSheetData | null; onClose: () => void }) {
  useLanguage();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null); // null = ملاءمة العرض
  const [paperHeight, setPaperHeight] = useState(1123);
  const scale = zoom ?? fit;

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (stage) setFit(Math.min(1, (stage.clientWidth - 24) / PAPER_PX));
    if (paperRef.current) setPaperHeight(paperRef.current.offsetHeight);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const ro = new ResizeObserver(measure);
    if (stageRef.current) ro.observe(stageRef.current);
    if (paperRef.current) ro.observe(paperRef.current);
    return () => ro.disconnect();
  }, [open, measure, data]);

  useEffect(() => {
    if (!open) return;
    setZoom(null);
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add("rx-printing");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const els = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("rx-printing");
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, onClose]);

  if (!open || !data) return null;

  const stepZoom = (dir: 1 | -1) => {
    const cur = scale;
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.01) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01);
    setZoom(next ?? cur);
  };

  return createPortal(
    <div className="rx-print-root fixed inset-0 z-50 flex flex-col bg-slate-800/80">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        {/* شريط الأدوات خارج الورقة وثابت أعلى المعاينة */}
        <div className="rx-no-print flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm sm:px-5">
          <div className="min-w-0 max-sm:sr-only">
            <h2 id={titleId} className="text-base font-bold text-slate-900">{t("معاينة الوصفة")}</h2>
            <p className="hidden text-xs text-slate-500 sm:block">{t("ورقة A4 كما ستُطبع. الطباعة لا تحفظ الوصفة ولا ترسلها ولا تغيّر الموعد.")}</p>
          </div>
          <div className="flex w-full items-center justify-between gap-1.5 sm:w-auto sm:justify-start">
            <div className="flex items-center rounded-xl border border-slate-200" role="group" aria-label={t("التكبير")}>
              <button type="button" onClick={() => stepZoom(-1)} className="flex h-11 w-11 items-center justify-center text-slate-700 hover:bg-slate-100" aria-label={t("تصغير")}>
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setZoom(null)} className="flex h-11 min-w-[3rem] items-center justify-center gap-1 px-1 text-xs font-semibold tabular-nums text-slate-700 hover:bg-slate-100" aria-label={t("ملاءمة العرض")} title={t("ملاءمة العرض")}>
                {zoom === null ? <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                <span dir="ltr">{Math.round(scale * 100)}%</span>
              </button>
              <button type="button" onClick={() => stepZoom(1)} className="flex h-11 w-11 items-center justify-center text-slate-700 hover:bg-slate-100" aria-label={t("تكبير")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <button type="button" onClick={onClose} className="btn-outline whitespace-nowrap px-3">
              <X className="h-4 w-4" aria-hidden="true" /> {t("رجوع للتعديل")}
            </button>
            <button type="button" onClick={() => window.print()} className="btn-primary whitespace-nowrap px-3">
              <Printer className="h-4 w-4" aria-hidden="true" /> {t("طباعة")}
            </button>
          </div>
        </div>

        {/* مساحة المعاينة القابلة للتمرير (أفقيًا أيضًا عند التكبير) — الورقة بأبعاد A4 مصغّرة */}
        <div ref={stageRef} className="rx-stage min-h-0 flex-1 overflow-auto p-3 sm:p-6">
          <div className="rx-scaler mx-auto" style={{ width: PAPER_PX * scale, height: paperHeight * scale }}>
            <div ref={paperRef} className="rx-paper" style={{ transform: `scale(${scale})` }}>
              <PrescriptionSheet data={data} />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
