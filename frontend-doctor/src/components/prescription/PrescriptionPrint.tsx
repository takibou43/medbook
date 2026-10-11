import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Maximize2, Minus, Plus, Printer, X } from "lucide-react";
import type { Doctor } from "../../types";
import type { PrescriptionMedication, PrescriptionRequestItem } from "../../lib/prescription";
import { DEFAULT_PRESCRIPTION_SETTINGS, type PrescriptionShow } from "../../lib/prescriptionSettings";
import { prescriptionLabels, prescriptionDate, prescriptionCatalogName, professionalText, doctorHeaderName, type PrescriptionLanguage, type PrescriptionProfessional } from "../../lib/prescriptionPrint";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import type { PrescriptionTemplate } from "../../lib/prescriptionTemplate";
import { Logo } from "../ui/Logo";
import { medicationParts, glueNumberUnit } from "../../lib/prescriptionMedication";

export interface PrescriptionSheetData {
  template?: PrescriptionTemplate | null;
  language: PrescriptionLanguage;
  professional?: PrescriptionProfessional;
  /** اسم الطبيب كما كتبه بنفسه لكل جهة: ar يمين الترويسة، fr يسارها. */
  doctorNames?: { ar?: string; fr?: string };
  doctor: Doctor | null | undefined;
  /** اسم المستفيد الفعلي كما كتبه/أكّده الطبيب (لا يُطبع صاحب الحساب ولا صلة القرابة). */
  patientName: string;
  /** YYYY-MM-DD بتوقيت الجزائر. */
  day: string;
  medications: PrescriptionMedication[];
  /** تحاليل وأشعة/فحوصات يطلبها الطبيب (اختيارية). */
  labs?: PrescriptionRequestItem[];
  imaging?: PrescriptionRequestItem[];
  /** إظهار/إخفاء البيانات الاختيارية في الترويسة (من إعدادات الطبيب). */
  show?: PrescriptionShow;
  notes: string;
  /** شعار الطبيب الخاص (اختياري) في وسط الترويسة؛ علامة مادبوك تبقى مائية خلف النص. */
  logo?: string | null;
}

/** نص كتبه الطبيب: يُعرض كما هو، معزول الاتجاه حتى لا تنقلب الأرقام والوحدات في النص المختلط. */
function Typed({ children, className }: { children: string; className?: string }) {
  return <bdi dir="auto" translate="no" className={className}>{children}</bdi>;
}

/**
 * ورقة الوصفة (A5) — نفس المكوّن ونفس البيانات في المعاينة والطباعة.
 * يُطبع فقط ما هو موجود فعلًا: لا شعار ولا عمر ولا رقم وصفة ولا QR ولا توقيع/ختم رقمي.
 */
export function PrescriptionSheet({ data }: { data: PrescriptionSheetData }) {
  const lang = data.language;
  const text = prescriptionLabels(lang);
  const d = data.doctor;
  const clinic = d?.clinic ?? null;
  const place = [d?.city ? prescriptionCatalogName(d.city, lang) : "", d?.wilaya ? prescriptionCatalogName(d.wilaya, lang) : ""].filter(Boolean).join(lang === "fr" ? ", " : "، ");
  const show = data.show ?? DEFAULT_PRESCRIPTION_SETTINGS.show;
  const address = show.address ? professionalText(data.professional?.address, clinic?.address || d?.address) : "";
  const accountName = d ? `${d.firstName} ${d.lastName}` : "";
  const doctorNameFr = doctorHeaderName(data.doctorNames?.fr, accountName, "fr");
  const doctorNameAr = doctorHeaderName(data.doctorNames?.ar, accountName, "ar");
  const clinicName = show.clinicName ? professionalText(data.professional?.clinicName, clinic?.nameAr) : "";
  const phone = show.phone ? (clinic?.phone || d?.phone || "").trim() : "";
    const standard = !data.template;
  const fr = prescriptionLabels("fr");
  const ar = prescriptionLabels("ar");
  const specialtyFr = show.specialty && d?.specialty ? prescriptionCatalogName(d.specialty, "fr") : "";
  const specialtyAr = show.specialty && d?.specialty ? prescriptionCatalogName(d.specialty, "ar") : "";
  const footerLine = [address, place].filter(Boolean).join(lang === "fr" ? " — " : " — ");
  const body = (
    <>
      {standard && (
        <div className="rx-watermark" aria-hidden="true">
          <Logo className="rx-watermark-mark" />
          <span className="rx-watermark-name" dir="ltr">MadBook | مادبوك</span>
        </div>
      )}
      {standard && <header className="rx-head rx-head-std">
        <div className="rx-side rx-side-fr" lang="fr" dir="ltr">
          {doctorNameFr && <p className="rx-doctor"><bdi dir="ltr">{fr.doctor}</bdi> <Typed>{doctorNameFr}</Typed></p>}
          {specialtyFr && <p className="rx-specialty">{specialtyFr}</p>}
          {clinicName && <p className="rx-clinic"><Typed>{clinicName}</Typed></p>}
          {phone && <p className="rx-line">Télé : <bdi dir="ltr" translate="no">{phone}</bdi></p>}
        </div>
        <div className="rx-logo-slot">{data.logo && <img src={data.logo} alt="" />}</div>
        <div className="rx-side rx-side-ar" lang="ar" dir="rtl">
          {doctorNameAr && <p className="rx-doctor"><bdi dir="rtl">{ar.doctor}</bdi> <Typed>{doctorNameAr}</Typed></p>}
          {specialtyAr && <p className="rx-specialty">{specialtyAr}</p>}
          {clinicName && <p className="rx-clinic"><Typed>{clinicName}</Typed></p>}
          {phone && <p className="rx-line">الهاتف : <bdi dir="ltr" translate="no">{phone}</bdi></p>}
        </div>
      </header>}

      {standard && <h1 className="rx-title">{text.title}</h1>}

      <dl className="rx-meta">
        <div>
          <dt>{text.date}</dt>
          <dd>{prescriptionDate(data.day, lang)}</dd>
        </div>
        <div>
          <dt>{text.patient}</dt>
          <dd className="rx-patient"><Typed>{data.patientName}</Typed></dd>
        </div>
      </dl>

      {data.medications.length > 0 && <ol className="rx-meds" aria-label={text.medications}>
        {data.medications.map((m, i) => {
          // نفس منطق التنسيق للمعاينة والطباعة والملخص: lib/prescriptionMedication.
          const p = medicationParts(m, lang);
          return (
            <li key={m.id} className="rx-med">
              <span className="rx-index" aria-hidden="true">{i + 1}</span>
              <div className="rx-med-body">
                {/* السطر 1: الاسم والتركيز بخط بارز */}
                <p className="rx-med-title">
                  <Typed className="rx-med-name">{p.name}</Typed>
                  {p.detail && <> <Typed className="rx-med-detail">{glueNumberUnit(p.detail)}</Typed></>}
                </p>
                {/* السطر 2: الجرعة، التكرار، التوقيت، المدة — كل رقم ملصوق بوحدته؛ الفاصل ملصوق بما قبله فلا يبدأ سطر به */}
                {p.facts.length > 0 && (
                  <p className="rx-med-facts">
                    {p.facts.map((v, k) => (
                      <Fragment key={k}>
                        {/* عنصر قصير = وحدة لا تنكسر («4 fois par jour»، «10 jours»)؛ النص الطويل المخصص يلتف عادي */}
                        <span className={v.length <= 28 ? "rx-fact rx-fact-keep" : "rx-fact"}><Typed>{glueNumberUnit(v)}</Typed>{k < p.facts.length - 1 && <span className="rx-sep" aria-hidden="true">{"\u00A0·"}</span>}</span>
                        {k < p.facts.length - 1 && " "}
                      </Fragment>
                    ))}
                  </p>
                )}
                {/* التعليمات: تلتف بحرّية، وتبدأ محاذية للنص لا لرقم الدواء */}
                {p.instructions && <p className="rx-med-instr"><Typed>{glueNumberUnit(p.instructions)}</Typed></p>}
              </div>
            </li>
          );
        })}
      </ol>}

      {([["labs", data.labs ?? []], ["imaging", data.imaging ?? []]] as const).map(([key, list]) => list.length > 0 && (
        <section key={key} className="rx-requests">
          <h2 className="rx-small-title">{text[key]}</h2>
          <ol className="rx-req-list">
            {list.map((r, i) => (
              <li key={r.id} className="rx-req"><span className="rx-req-n" aria-hidden="true">{i + 1}.</span>{" "}<Typed className="rx-req-name">{r.name}</Typed>{r.note && <><span className="rx-sep" aria-hidden="true">{"\u00A0—"}</span>{" "}<Typed>{r.note}</Typed></>}</li>
            ))}
          </ol>
        </section>
      ))}

      {data.notes.trim() && (
        <section className="rx-notes">
          <h2 className="rx-small-title">{text.notes}</h2>
          <p className="rx-notes-body"><Typed>{data.notes.trim()}</Typed></p>
        </section>
      )}

      {standard && footerLine && <p className="rx-foot"><Typed>{footerLine}</Typed></p>}
    </>
  );
  const articleProps = { className: `rx-sheet${standard ? " rx-standard" : ""}`, dir: lang === "fr" ? "ltr" : "rtl", lang, "aria-label": text.sheet } as const;
  // الورقة القياسية: جدول إطار بصفّي حشو (أعلى/أسفل) يتكرران في كل صفحة مطبوعة، لأن هامش الصفحة صفر
  // (لا هامش = لا مكان تضيف فيه المتصفحات الرابط والعنوان والوقت). الجدول للتنسيق فقط ولا معنى دلاليًا له.
  if (standard) {
    return (
      <article {...articleProps}>
        <table className="rx-frame" role="presentation">
          <thead aria-hidden="true"><tr><td className="rx-pad" /></tr></thead>
          <tbody><tr><td className="rx-frame-body"><div className="rx-inner">{body}</div></td></tr></tbody>
          <tfoot aria-hidden="true"><tr><td className="rx-pad" /></tr></tfoot>
        </table>
      </article>
    );
  }
  return <article {...articleProps}>{body}</article>;
}

const PAPER_PX = 148 * 96 / 25.4; // A5: 148mm بدقة 96dpi
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * معاينة قبل الطباعة: ورقة A5 بأبعادها الحقيقية مصغّرة لتلائم الشاشة (نفس الورقة على الهاتف والكمبيوتر)،
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
  const [paperHeight, setPaperHeight] = useState(210 * 96 / 25.4);
  const [useTemplate, setUseTemplate] = useState(true);
  const [imageReady, setImageReady] = useState(false);
  const [imageError, setImageError] = useState(false);
  const template = useTemplate ? data?.template : null;
  const templateOverflow = Boolean(template && paperHeight > 210 * 96 / 25.4 + 2);
  const scale = zoom ?? fit;
  // Browser keyboard/menu printing must also preserve every medication when the custom sheet cannot fit.
  useEffect(() => {
    if (!open) return;
    const beforePrint = () => {
      if (template && (templateOverflow || !imageReady || imageError)) flushSync(() => setUseTemplate(false));
    };
    window.addEventListener("beforeprint", beforePrint);
    return () => window.removeEventListener("beforeprint", beforePrint);
  }, [open, template, templateOverflow, imageReady, imageError]);

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
        const els = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
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

  useEffect(() => {
    if (!open) return;
    setUseTemplate(true);
    const img = paperRef.current?.querySelector("img");
    setImageReady(Boolean(img?.complete && img.naturalWidth));
    setImageError(false);
  }, [open, data?.template?.image]);

  if (!open || !data) return null;

  const stepZoom = (dir: 1 | -1) => {
    const cur = scale;
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.01) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01);
    setZoom(next ?? cur);
  };

  return createPortal(
    <div className="rx-print-root fixed inset-0 z-50 flex flex-col bg-slate-800/80">
      {!template && <style>{`@page { size: A5 portrait; margin: 0; }`}</style>}
      {template && <style>{`@page { size: A5 portrait; margin: 0; } @media print { .rx-paper.rx-custom-paper { padding: ${template.top}mm ${template.side}mm ${template.bottom}mm !important; } }`}</style>}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        {/* شريط الأدوات خارج الورقة وثابت أعلى المعاينة */}
        <div className="rx-no-print flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm sm:px-5">
          {data.template && <label className="text-sm"><input type="checkbox" checked={useTemplate} onChange={e => setUseTemplate(e.target.checked)} /> {data.language === "fr" ? "Utiliser mon modèle" : "استخدام قالبي المحفوظ"}</label>}
          {templateOverflow && <p role="alert" className="w-full text-sm text-red-700">{data.language === "fr" ? "Le contenu dépasse la zone du modèle. Désactivez le modèle pour imprimer toutes les pages sans couper le texte." : "المحتوى يتجاوز مساحة القالب. ألغِ استخدام القالب لطباعة الوصفة كاملة على عدة صفحات دون قص النص."}</p>}
          {imageError && <p role="alert" className="text-red-700">{data.language === "fr" ? "Image illisible. Désactivez le modèle." : "تعذر عرض الصورة. ألغِ استخدام القالب."}</p>}
          <div className="min-w-0 max-sm:sr-only">
            <h2 id={titleId} className="text-base font-bold text-slate-900">{t("معاينة الوصفة")}</h2>
            <p className="hidden text-xs text-slate-500 sm:block">{t("ورقة A5 كما ستُطبع. الطباعة لا تحفظ الوصفة ولا ترسلها ولا تغيّر الموعد.")}</p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-1.5 sm:w-auto sm:justify-start">
            <div className="flex items-center rounded-xl border border-slate-200" role="group" aria-label={t("التكبير")}>
              <button type="button" onClick={() => stepZoom(-1)} className="flex h-11 w-9 items-center justify-center text-slate-700 hover:bg-slate-100 sm:w-11" aria-label={t("تصغير")}>
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setZoom(null)} className="flex h-11 min-w-[3rem] items-center justify-center gap-1 px-1 text-xs font-semibold tabular-nums text-slate-700 hover:bg-slate-100" aria-label={t("ملاءمة العرض")} title={t("ملاءمة العرض")}>
                {zoom === null ? <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                <span dir="ltr">{Math.round(scale * 100)}%</span>
              </button>
              <button type="button" onClick={() => stepZoom(1)} className="flex h-11 w-9 items-center justify-center text-slate-700 hover:bg-slate-100 sm:w-11" aria-label={t("تكبير")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <button type="button" onClick={onClose} className="btn-outline whitespace-nowrap px-2 text-xs sm:px-3 sm:text-sm">
              <X className="h-4 w-4" aria-hidden="true" /> {t("رجوع للتعديل")}
            </button>
            <button type="button" disabled={templateOverflow || Boolean(template && (!imageReady || imageError))} onClick={() => window.print()} className="btn-primary whitespace-nowrap px-2 text-xs sm:px-3 sm:text-sm">
              <Printer className="h-4 w-4" aria-hidden="true" /> {t("طباعة")}
            </button>
          </div>
          <p className="w-full text-xs leading-5 text-slate-600">{t("عند الطباعة: اختر ورق A5 والحجم الفعلي 100%. إن ظهر في الورقة رابط الموقع أو عنوان الصفحة أو الوقت فهي إضافات المتصفح؛ ألغِ «Headers and footers» من إعدادات الطباعة.")}</p>
        </div>

        {/* مساحة المعاينة القابلة للتمرير (أفقيًا أيضًا عند التكبير) — الورقة بأبعاد A5 مصغّرة */}
        <div ref={stageRef} className="rx-stage min-h-0 flex-1 overflow-auto p-3 sm:p-6">
          <div className="rx-scaler mx-auto" style={{ width: PAPER_PX * scale, height: paperHeight * scale }}>
            <div ref={paperRef} className={`rx-paper${template ? " rx-custom-paper" : ""}`} style={{ transform: `scale(${scale})`, ...(template ? { paddingTop: `${template.top}mm`, paddingBottom: `${template.bottom}mm`, paddingLeft: `${template.side}mm`, paddingRight: `${template.side}mm` } : {}) }}>
              {template && <img className="rx-template-image" src={template.image} alt="" onLoad={() => { setImageReady(true); setImageError(false); measure(); }} onError={() => { setImageReady(false); setImageError(true); }} />}
              <PrescriptionSheet data={{ ...data, template, logo: data.logo ?? data.template?.design?.logo ?? null }} />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
