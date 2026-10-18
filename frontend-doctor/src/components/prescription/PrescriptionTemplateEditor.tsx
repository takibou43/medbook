import { useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { DEFAULT_PRINTED_FORM_FIELDS, readTemplateImage, type PrescriptionTemplate } from "../../lib/prescriptionTemplate";
import { useLanguage } from "../../i18n/LanguageRoot";
import type { Doctor } from "../../types";
import { VisualPrescriptionDesigner as PrescriptionDesigner } from "./VisualPrescriptionDesigner";
import { Modal } from "../ui/Modal";
import { PrescriptionPreview } from "./PrescriptionPrint";
import type { PrescriptionDesign } from "../../lib/prescriptionDesign";

export function PrescriptionTemplateEditor({ value, onChange, doctor, names, language }: { language: "ar" | "fr"; value: PrescriptionTemplate | null; onChange: (value: PrescriptionTemplate | null) => void; doctor?: Doctor | null; names?: { ar?: string; fr?: string } }) {
  const fr = useLanguage() === "fr";
  const [editing, setEditing] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const [mode, setMode] = useState<"image" | "design">(value?.design && value.design.source !== "image" ? "design" : "image");
  function imageDesign(): PrescriptionDesign {
    return draft?.design?.source === "image" ? draft.design : { version: 1, source: "image", language, doctorName: "قالب مرفوع", specialty: "", clinicName: "", address: "", phone: "", footer: "", color: "#1574ad", layout: "split", logo: null, logoPosition: "center", headerSize: 18 };
  }
  function printMode(next: "blank" | "preprinted") {
    if (!draft) return;
    const design = imageDesign();
    setDraft({ ...draft, design: { ...design, printMode: next } });
  }
  async function save(remove = false, next = draft) {
    setBusy(true); setError("");
    try {
      if (remove) await api.delete("/doctor/prescription-template");
      else await api.put("/doctor/prescription-template", next);
      onChange(remove ? null : next); setEditing(false); setDesignerOpen(false);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      const message = status === 401 ? (fr ? "Session expirée. Reconnectez-vous puis réessayez." : "انتهت جلسة الدخول. سجّل الدخول مجددًا ثم أعد الحفظ.")
        : status === 413 ? (fr ? "Le serveur a refusé la taille du modèle." : "رفض الخادم حجم القالب. جرّب صورة أصغر.")
        : apiErrorMessage(err, fr ? "Impossible d’enregistrer le modèle. Réessayez." : "تعذر حفظ القالب. أعد المحاولة.");
      setError(message);
    }
    finally { setBusy(false); }
  }
  return <div className="my-3 rounded-xl border border-slate-200 p-3">
    <button type="button" disabled={busy} className="btn-outline" onClick={() => { setDraft(value); setMode(value?.design && value.design.source !== "image" ? "design" : "image"); setError(""); setEditing(!editing); }}>{fr ? "Mon modèle A5" : "قالب الطبيب A5"}</button>
    {value && <span className="mx-2 text-sm text-emerald-700">{fr ? "Enregistré dans votre compte" : "محفوظ في حسابك"}</span>}
    {editing && <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label={fr ? "Source du modèle" : "طريقة إنشاء القالب"}>
        <button type="button" disabled={busy} aria-haspopup="dialog" className="btn-primary" onClick={() => { setMode("design"); setError(""); setDesignerOpen(true); }}>{fr ? "Choisir / personnaliser un modèle" : "اختيار وتخصيص قالب جاهز"}</button>
        <button type="button" disabled={busy} aria-pressed={mode === "image"} className={mode === "image" ? "btn-primary" : "btn-outline"} onClick={() => { setMode("image"); setError(""); }}>{fr ? "Importer une feuille vierge" : "رفع صورة وصفة فارغة"}</button>
      </div>
      {mode === "design" ? <p className="text-sm text-slate-600">{fr ? "Renseignez vos informations. Mise en page automatique." : "أدخل بياناتك والشعار؛ نرتب القالب تلقائيًا."}</p> : <>
      <p className="text-sm text-slate-600">{fr ? "Choisissez une image verticale JPEG, PNG ou WebP (10 Mo maximum), sans données patient. Elle sera adaptée à A5 sans déformation. Vérifiez l’aperçu puis enregistrez." : "اختر صورة عمودية JPEG أو PNG أو WebP (حتى 10 ميغابايت)، دون بيانات مرضى. نكيّفها مع A5 دون تشويه. راجع المعاينة ثم اضغط حفظ القالب."}</p>
      <input type="file" accept="image/png,image/jpeg,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy} aria-label={fr ? "Image du modèle vierge" : "صورة قالب الوصفة الفارغة"} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        setBusy(true); setError("");
        try {
          const image = await readTemplateImage(file);
          setDraft({ image, top: 40, bottom: 16, side: 10, design: { ...imageDesign(), formFields: undefined } });
        }
        catch (err) { setError((fr ? "Importation impossible : " : "تعذر استيراد الصورة: ") + (err as Error).message); }
        finally { setBusy(false); }
      }} />
      {draft && <>
        <p role="status" className="text-sm text-emerald-700">{fr ? "Image prête. Réglez le contenu de la feuille puis enregistrez." : "الصورة جاهزة. حدّد نوع الورقة ثم احفظ القالب."}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy} checked={Boolean(draft.design?.formFields)} onChange={e => {
          const complete = e.target.checked;
          setDraft({ ...draft, top: complete ? 75 : 40, design: { ...imageDesign(), formFields: complete ? structuredClone(DEFAULT_PRINTED_FORM_FIELDS) : undefined } });
        }} />{fr ? "L’image contient déjà le titre et les champs date / patient / âge" : "الصورة تتضمن عنوان الوصفة وخانات التاريخ والمريض والعمر"}</label>
        {draft.design?.formFields && <details className="rounded border p-3"><summary className="cursor-pointer text-sm">{fr ? "Positionner les données sur les champs imprimés (mm)" : "ضبط مواضع البيانات فوق الخانات المطبوعة (مم)"}</summary>
          <p className="mt-2 text-xs text-slate-600">{fr ? "Seules les valeurs sont ajoutées, sans répéter le titre ni les libellés. Le nom complet reste un seul champ." : "نضيف القيم فقط دون تكرار العنوان أو التسميات. اسم المريض الكامل حقل واحد؛ ضعه في المساحة المناسبة ثم استخدم طباعة الاختبار."}</p>
          {(["date", "patient", "age"] as const).map(key => <fieldset className="mt-2" key={key}><legend className="text-sm font-semibold">{key === "date" ? (fr ? "Date" : "التاريخ") : key === "patient" ? (fr ? "Nom complet" : "الاسم الكامل") : (fr ? "Âge" : "العمر")}</legend><div className="grid grid-cols-3 gap-2">
            {(["x", "y", "width"] as const).map(axis => <label key={axis} className="text-xs">{axis === "x" ? (fr ? "Depuis la gauche" : "من اليسار") : axis === "y" ? (fr ? "Depuis le haut" : "من الأعلى") : (fr ? "Largeur" : "العرض")}<input type="number" className="input mt-1 w-full" min={axis === "width" ? 5 : 0} max={axis === "y" ? 70 : axis === "x" ? 140 : 148} value={draft.design!.formFields![key][axis]} onChange={e => {
              const fields = structuredClone(draft.design!.formFields!);
              fields[key][axis] = Math.max(axis === "width" ? 5 : 0, Math.min(axis === "y" ? 70 : axis === "x" ? 140 : 148, Number(e.target.value)));
              fields[key].width = Math.min(fields[key].width, 148 - fields[key].x);
              setDraft({ ...draft, design: { ...imageDesign(), formFields: fields } });
            }} /></label>)}
          </div></fieldset>)}
        </details>}
        <label className="block text-sm">{fr ? "Imprimer sur" : "الطباعة على"}<select disabled={busy} className="input mt-1 w-full" value={draft.design?.printMode ?? "blank"} onChange={e => printMode(e.target.value as "blank" | "preprinted")}><option value="blank">{fr ? "Papier blanc — fond et contenu" : "ورق أبيض — الخلفية والمحتوى"}</option><option value="preprinted">{fr ? "Papier préimprimé — contenu seul" : "ورق مطبوع مسبقًا — المحتوى فقط"}</option></select></label>
        <details><summary className="cursor-pointer text-sm">{fr ? "Calibrage d’impression" : "ضبط الطباعة عند الحاجة"}</summary><div className="mt-2 flex flex-wrap gap-3">{(["top", "bottom", "side"] as const).map(key => <label key={key} className="text-sm">{({ top: fr ? "Marge haute" : "الهامش العلوي", bottom: fr ? "Marge basse" : "الهامش السفلي", side: fr ? "Marges latérales" : "الهوامش الجانبية" })[key]}
          <input type="range" className="block" min={key === "side" ? 5 : 10} max={key === "top" ? 75 : key === "bottom" ? 60 : 30} value={draft[key]} disabled={busy} onChange={e => setDraft({ ...draft, [key]: Number(e.target.value) })} /><span dir="ltr">{draft[key]} mm</span>
        </label>)}</div></details>
        <div className="relative mx-auto border bg-white" style={{ width: 222, height: 315 }}>
          <img src={draft.image} alt="" className="absolute inset-0 h-full w-full" />
          <div className="absolute border-2 border-dashed border-teal-600 text-center text-xs text-teal-900" style={{ top: draft.top * 1.5, bottom: draft.bottom * 1.5, left: draft.side * 1.5, right: draft.side * 1.5 }}>{fr ? "Zone d’écriture" : "مساحة الكتابة"}</div>
        </div>
        <button type="button" disabled={busy} className="btn-outline" onClick={() => setTestOpen(true)}>{fr ? "Impression test" : "طباعة اختبار"}</button>
        <button type="button" disabled={busy} className="btn-primary mx-2" onClick={() => save()}>{busy ? (fr ? "Enregistrement…" : "جارٍ الحفظ…") : (fr ? "Enregistrer le modèle" : "حفظ القالب")}</button>
      </>}
      <button type="button" disabled={busy} className="btn-outline" onClick={() => { setDraft(value); setEditing(false); }}>{fr ? "Annuler" : "إلغاء"}</button>
      </>}
      {value && <button type="button" disabled={busy} className="btn-outline mx-2" onClick={() => save(true)}>{fr ? "Supprimer le modèle" : "حذف القالب"}</button>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>}
    <Modal wide open={designerOpen} onClose={() => { if (!busy) setDesignerOpen(false); }} title={fr ? "Créer / modifier mon ordonnance" : "إنشاء وتعديل تصميم الوصفة"}>
      {designerOpen && <PrescriptionDesigner value={value} doctor={doctor} names={names} language={language} saving={busy} onSave={next => save(false, next)} onCancel={() => setDesignerOpen(false)} />}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Modal>
    <PrescriptionPreview open={testOpen} onClose={() => setTestOpen(false)} data={draft ? { template: draft, doctor, language, patientName: language === "fr" ? "Patient test" : "مريض تجريبي", day: "2026-10-14", medications: [], notes: language === "fr" ? "Texte de test. Aucune donnée patient." : "نص تجريبي لاختبار موضع الكتابة، دون بيانات مرضى." } : null} />
  </div>;
}
