import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Doctor } from "../../types";
import { useLanguage } from "../../i18n/LanguageRoot";
import { arrangeSimpleHeader, readSimpleHeader, initialDesignElements, overlapsWritingArea, readPrescriptionLogo, renderPrescriptionDesign, type DesignElement, type PrescriptionDesign, type SimplePrescriptionHeader } from "../../lib/prescriptionDesign";
import type { PrescriptionTemplate } from "../../lib/prescriptionTemplate";

export function VisualPrescriptionDesigner({ value, doctor, saving, onSave, names }: { value: PrescriptionTemplate | null; doctor?: Doctor | null; saving: boolean; onSave: (template: PrescriptionTemplate) => void; names?: { ar?: string; fr?: string } }) {
  const fr = useLanguage() === "fr";
  const t = (ar: string, french: string) => fr ? french : ar;
  const [design, setDesign] = useState<PrescriptionDesign>(() => {
    const base: PrescriptionDesign = value?.design ?? { version: 1, language: fr ? "fr" : "ar", doctorName: doctor ? `${doctor.firstName} ${doctor.lastName}` : "", specialty: (fr ? doctor?.specialty?.nameFr : doctor?.specialty?.nameAr) || "", clinicName: doctor?.clinic?.nameAr || "", address: doctor?.clinic?.address || doctor?.address || "", phone: doctor?.clinic?.phone || doctor?.phone || "", footer: "", color: "#187f77", layout: "split", logo: null, logoPosition: "left", headerSize: 18 };
    const next = { ...base, elements: initialDesignElements(base), writingArea: base.writingArea ?? { top: 60, bottom: 30, side: 12 } };
    return arrangeSimpleHeader(next, readSimpleHeader(next, names));
  });
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<string | null>(design.elements?.[0]?.id ?? null);
  const [preview, setPreview] = useState<PrescriptionTemplate | null>(null);
  const [rendering, setRendering] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const [history, setHistory] = useState<PrescriptionDesign[]>([]), [future, setFuture] = useState<PrescriptionDesign[]>([]);
  const paper = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: string; px: number; py: number; original: DesignElement; before: PrescriptionDesign; resize: boolean; moved: boolean } | null>(null);
  const elements = design.elements ?? [], active = elements.find(e => e.id === selected), area = design.writingArea!;
  const disabled = saving || uploading, overlap = elements.some(e => overlapsWritingArea(e, area));
  const simple = readSimpleHeader(design, names);
  const incomplete = !simple.nameAr.trim() && !simple.nameFr.trim();
  function updateSimple(patch: Partial<SimplePrescriptionHeader>) { change(arrangeSimpleHeader(design, { ...simple, ...patch })); }
  function change(next: PrescriptionDesign) { setHistory(h => [...h.slice(-29), design]); setFuture([]); setDesign(next); }
  function patchElement(patch: Partial<DesignElement>) {
    if (!active) return;
    const next = { ...active, ...patch };
    next.x = Math.max(0, Math.min(148 - next.width, next.x)); next.y = Math.max(0, Math.min(210 - next.height, next.y));
    change({ ...design, elements: elements.map(e => e.id === active.id ? next : e) });
  }
  useEffect(() => {
    let alive = true; setRendering(true); setError("");
    const timer = window.setTimeout(() => { renderPrescriptionDesign(design).then(p => { if (alive) setPreview(p); }).catch(e => { if (alive) { setPreview(null); setError((e as Error).message); } }).finally(() => { if (alive) setRendering(false); }); }, 100);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [design]);
  function begin(event: PointerEvent<HTMLDivElement>, element: DesignElement, resize = false) {
    if (disabled) return; event.preventDefault(); event.stopPropagation(); setSelected(element.id); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: element.id, px: event.clientX, py: event.clientY, original: element, before: design, resize, moved: false };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current, bounds = paper.current?.getBoundingClientRect(); if (!g || !bounds) return;
    const dx = (event.clientX - g.px) * 148 / bounds.width, dy = (event.clientY - g.py) * 210 / bounds.height, e = g.original;
    if (dx !== 0 || dy !== 0) g.moved = true;
    const patch = g.resize ? { width: Math.max(5, Math.min(148 - e.x, e.width + dx)), height: Math.max(5, Math.min(210 - e.y, e.height + dy)) } : { x: Math.max(0, Math.min(148 - e.width, e.x + dx)), y: Math.max(0, Math.min(210 - e.height, e.y + dy)) };
    setDesign(d => ({ ...d, elements: d.elements!.map(item => item.id === g.id ? { ...item, ...patch } : item) }));
  }
  function end() { if (gesture.current) { const { before, moved } = gesture.current; if (moved) { setHistory(h => [...h.slice(-29), before]); setFuture([]); } gesture.current = null; } }
  function addText() {
    const id = crypto.randomUUID(); const e: DesignElement = { id, kind: "text", text: t("نص جديد", "Nouveau texte"), x: 45, y: 10, width: 80, height: 12, fontSize: 5, font: fr ? "Arial" : "Cairo", color: "#187f77", bold: false, align: fr ? "left" : "right" };
    change({ ...design, elements: [...elements, e] }); setSelected(id);
  }
  return <div className="space-y-3">
    <style>{`@media (min-width: 600px) { .rx-design-workspace { grid-template-columns: 200px minmax(0, 1fr); } } @media (min-width: 1024px) { .rx-design-workspace { grid-template-columns: 280px minmax(0, 1fr); } }`}</style>
    <p className="text-sm text-slate-600">{advanced ? t("اسحب العناصر لتخصيص أماكنها، ثم حدّد النص لتعديل خطه ولونه.", "Glissez les éléments et sélectionnez un texte pour modifier son style.") : t("اكتب بياناتك وارفع شعارك. نرتّب الاسم بالعربية يمينًا، والشعار في الوسط، والاسم بالفرنسية يسارًا تلقائيًا.", "Renseignez vos informations : nom arabe à droite, logo au centre et nom français à gauche, automatiquement.")}</p>
    <div className="flex flex-wrap gap-2 rounded-xl bg-slate-100 p-3">
      {advanced && <button type="button" className="btn-primary" disabled={disabled || elements.length >= 30} onClick={addText}>{t("+ إضافة نص", "+ Ajouter du texte")}</button>}
      <label className="btn-outline cursor-pointer">{t("إضافة / تغيير الشعار", "Ajouter / changer le logo")}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || (!elements.some(e => e.kind === "logo") && elements.length >= 30)} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setUploading(true); setError("");
        try { const logo = await readPrescriptionLogo(file), existing = elements.find(e => e.kind === "logo");
          const item: DesignElement = existing ?? { id: "logo", kind: "logo", text: "", x: 56, y: 8, width: 36, height: 24, fontSize: 4, font: "Arial", color: "#187f77", bold: false, align: "center" };
          const next = { ...design, logo, elements: existing ? elements : [...elements, item] };
          change(advanced ? next : arrangeSimpleHeader(next, simple)); setSelected(item.id);
        } catch (e) { setError((e as Error).message); } finally { setUploading(false); }
      }} /></label>
      <button type="button" className="btn-outline" disabled={disabled} onClick={() => { change(arrangeSimpleHeader(design, simple)); setAdvanced(false); }}>{t("إعادة الترتيب", "Réorganiser")}</button>
      <button type="button" className="btn-outline" disabled={disabled} aria-pressed={advanced} onClick={() => setAdvanced(a => !a)}>{advanced ? t("العودة للوضع البسيط", "Mode simple") : t("تعديل متقدم", "Modification avancée")}</button>
      <button type="button" className="btn-outline" disabled={disabled || !history.length} onClick={() => { setFuture(f => [...f, design]); setDesign(history[history.length - 1]); setHistory(h => h.slice(0, -1)); }}>{t("تراجع", "Annuler")}</button>
      <button type="button" className="btn-outline" disabled={disabled || !future.length} onClick={() => { setHistory(h => [...h, design]); setDesign(future[future.length - 1]); setFuture(f => f.slice(0, -1)); }}>{t("إعادة", "Rétablir")}</button>
      <button type="button" className="btn-primary" disabled={disabled || rendering || !preview || overlap || incomplete || elements.length > 30 || Boolean(error)} onClick={() => { if (preview) onSave(preview); }}>{saving ? t("جارٍ الحفظ…", "Enregistrement…") : t("حفظ التصميم", "Enregistrer le design")}</button>
    </div>
    <div className="rx-design-workspace grid gap-4">
      <aside className="space-y-4 rounded-xl border bg-slate-50 p-3">
        {!advanced && <fieldset disabled={disabled} className="space-y-3">
          <legend className="mb-2 font-bold">{t("بيانات الوصفة", "Informations de l’ordonnance")}</legend>
          {([{ key: "nameAr", label: t("اسم الطبيب بالعربية", "Nom du médecin en arabe"), dir: "rtl", max: 120 }, { key: "nameFr", label: t("اسم الطبيب بالفرنسية", "Nom du médecin en français"), dir: "ltr", max: 120 }, { key: "specialty", label: t("التخصص", "Spécialité"), dir: "auto", max: 120 }, { key: "clinic", label: t("اسم العيادة", "Cabinet"), dir: "auto", max: 120 }, { key: "address", label: t("العنوان", "Adresse"), dir: "auto", max: 180 }, { key: "phone", label: t("الهاتف", "Téléphone"), dir: "ltr", max: 60 }, { key: "footer", label: t("نص أسفل الوصفة", "Pied de page"), dir: "auto", max: 240 }] as const).map(field => <label key={field.key} className="block text-sm">{field.label}<input className="input mt-1 w-full" dir={field.dir} maxLength={field.max} value={simple[field.key]} onChange={e => updateSimple({ [field.key]: e.target.value })} /></label>)}
          <p className="text-xs text-slate-500">{t("اكتب الاسم في كل لغة كما تريد ظهوره؛ لا تتم ترجمته تلقائيًا.", "Saisissez chaque nom tel qu’il doit apparaître, sans traduction automatique.")}</p>
          <label className="block text-sm">{t("لون الترويسة", "Couleur de l’en-tête")}<input className="block h-10 w-20" type="color" value={simple.color} onChange={e => updateSimple({ color: e.target.value })} /></label>
          {design.logo && <button type="button" className="btn-outline" onClick={() => change(arrangeSimpleHeader({ ...design, logo: null }, simple))}>{t("إزالة الشعار", "Retirer le logo")}</button>}
        </fieldset>}
        {advanced && <>
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="font-bold">{t("العنصر المحدد", "Élément sélectionné")}</legend>
          {active ? <>
            {active.kind === "text" && <>
              <label className="block text-sm">{t("النص", "Texte")}<textarea className="input mt-1 w-full" dir="auto" rows={3} value={active.text} maxLength={500} onChange={e => patchElement({ text: e.target.value })} /></label>
              <label className="block text-sm">{t("الخط", "Police")}<select className="input w-full" value={active.font} onChange={e => patchElement({ font: e.target.value as DesignElement["font"] })}>{["Cairo", "Arial", "Tahoma"].map(font => <option key={font}>{font}</option>)}</select></label>
              <label className="block text-sm">{t("حجم الخط", "Taille du texte")}<input className="block w-full" type="range" min={2} max={12} step={0.5} value={active.fontSize} onChange={e => patchElement({ fontSize: Number(e.target.value) })} /></label>
              <div className="flex items-center gap-3"><label>{t("اللون", "Couleur")}<input className="block h-10 w-16" type="color" value={active.color} onChange={e => patchElement({ color: e.target.value })} /></label><label><input type="checkbox" checked={active.bold} onChange={e => patchElement({ bold: e.target.checked })} /> {t("عريض", "Gras")}</label></div>
              <label className="block text-sm">{t("محاذاة النص", "Alignement")}<select className="input w-full" value={active.align} onChange={e => patchElement({ align: e.target.value as DesignElement["align"] })}><option value="right">{t("يمين", "Droite")}</option><option value="center">{t("وسط", "Centre")}</option><option value="left">{t("يسار", "Gauche")}</option></select></label>
            </>}
            <div className="grid grid-cols-2 gap-2">{(["x", "y", "width", "height"] as const).map(key => <label className="text-xs" key={key}>{({ x: t("أفقي (مم)", "X (mm)"), y: t("عمودي (مم)", "Y (mm)"), width: t("العرض (مم)", "Largeur (mm)"), height: t("الارتفاع (مم)", "Hauteur (mm)") })[key]}<input className="input mt-1 w-full" type="number" step={1} min={key === "width" || key === "height" ? 5 : 0} max={key === "x" || key === "width" ? 148 : 210} value={Math.round(active[key])} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) patchElement({ [key]: Math.max(key === "width" || key === "height" ? 5 : 0, Math.min(key === "x" || key === "width" ? 148 : 210, n)) }); }} /></label>)}</div>
            <button type="button" className="btn-outline w-full" onClick={() => { change({ ...design, elements: elements.filter(e => e.id !== active.id), ...(active.kind === "logo" ? { logo: null } : {}) }); setSelected(null); }}>{t("حذف العنصر", "Supprimer l’élément")}</button>
          </> : <p className="text-sm text-slate-500">{t("اضغط على عنصر في الورقة لتعديله.", "Sélectionnez un élément sur la feuille.")}</p>}
        </fieldset>
        <details><summary className="cursor-pointer font-semibold">{t("مساحة كتابة الوصفة", "Zone de prescription")}</summary><fieldset disabled={disabled} className="mt-2 space-y-2">{(["top", "bottom", "side"] as const).map(key => <label className="block text-sm" key={key}>{({ top: t("الهامش العلوي", "Marge haute"), bottom: t("الهامش السفلي", "Marge basse"), side: t("الهوامش الجانبية", "Marges latérales") })[key]}<input className="block w-full" type="range" min={key === "side" ? 5 : 10} max={key === "top" ? 75 : key === "bottom" ? 60 : 30} value={area[key]} onChange={e => change({ ...design, writingArea: { ...area, [key]: Number(e.target.value) } })} /><span>{area[key]} mm</span></label>)}</fieldset></details>
        </>}
      </aside>
      <div className="min-w-0 overflow-auto rounded-xl bg-slate-200 p-4">
        <div ref={paper} aria-label={t("ورقة التصميم A5", "Feuille A5")} className="relative mx-auto bg-white shadow-lg" style={{ width: "100%", maxWidth: 444, aspectRatio: "148 / 210" }} onPointerDown={() => setSelected(null)}>
          {preview && <img draggable={false} src={preview.image} alt={t("معاينة التصميم", "Aperçu du design")} className="pointer-events-none absolute inset-0 h-full w-full" />}
          {advanced && <div className="pointer-events-none absolute border border-dashed border-teal-400 bg-teal-50/20 text-center text-xs text-teal-700" style={{ top: `${area.top / 210 * 100}%`, bottom: `${area.bottom / 210 * 100}%`, left: `${area.side / 148 * 100}%`, right: `${area.side / 148 * 100}%` }}>{t("مساحة بيانات الوصفة — لا تُطبع الحدود", "Zone de prescription — cadre non imprimé")}</div>}
          {advanced && elements.map(e => <div key={e.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={e.kind === "logo" ? t("تحريك الشعار", "Déplacer le logo") : `${t("تحريك النص", "Déplacer le texte")}: ${e.text}`} aria-pressed={selected === e.id} onFocus={() => setSelected(e.id)} onPointerDown={event => begin(event, e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={event => {
            if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); const step = event.shiftKey ? 5 : 1;
            patchElement({ x: e.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), y: e.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) });
          }} style={{ position: "absolute", left: `${e.x / 148 * 100}%`, top: `${e.y / 210 * 100}%`, width: `${e.width / 148 * 100}%`, height: `${e.height / 210 * 100}%`, cursor: "move", touchAction: "none", outline: selected === e.id ? "2px solid #7c3aed" : "1px dashed #94a3b866" }}>
            {selected === e.id && <div aria-label={t("تغيير حجم العنصر", "Redimensionner l’élément")} onPointerDown={event => begin(event, e, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} style={{ position: "absolute", right: -6, bottom: -6, width: 12, height: 12, background: "#7c3aed", border: "2px solid white", cursor: "nwse-resize", touchAction: "none" }} />}
          </div>)}
        </div><p className="mt-2 text-center text-xs text-slate-600">{t("معاينة الوصفة", "Aperçu de l’ordonnance")} · A5{advanced && ` · ${t("يمكن التحريك أيضًا بمفاتيح الأسهم", "Déplacement possible avec les flèches")}`}</p>
      </div>
    </div>
    {overlap && <p role="alert" className="text-sm text-amber-800">{t("يوجد عنصر داخل مساحة بيانات الوصفة. حرّكه أو عدّل الهوامش قبل الحفظ حتى لا يغطي بيانات المريض والأدوية.", "Un élément recouvre la zone de prescription. Déplacez-le ou ajustez les marges avant d’enregistrer.")}</p>}
    {incomplete && <p role="alert" className="text-sm text-amber-800">{t("أدخل اسم الطبيب بالعربية أو الفرنسية للحفظ.", "Saisissez le nom du médecin en arabe ou en français.")}</p>}
    {elements.length > 30 && <p role="alert" className="text-sm text-amber-800">{t("التصميم يحتوي عناصر إضافية كثيرة. احذف بعضها من التعديل المتقدم للحفظ.", "Supprimez quelques éléments en mode avancé pour enregistrer.")}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {rendering && <p role="status" className="text-xs text-slate-500">{t("جارٍ تحديث المعاينة…", "Mise à jour de l’aperçu…")}</p>}
  </div>;
}
