import { useEffect, useMemo, useState } from "react";
import type { Doctor } from "../../types";
import { useLanguage } from "../../i18n/LanguageRoot";
import { arrangeSimpleHeader, canBalancePrescriptionDesign, readSimpleHeader, overlapsWritingArea, readPrescriptionLogo, renderPrescriptionDesign, type PrescriptionDesign, type SimplePrescriptionHeader } from "../../lib/prescriptionDesign";
import type { PrescriptionTemplate } from "../../lib/prescriptionTemplate";
import { PrescriptionPreview } from "./PrescriptionPrint";
import { prescriptionBranding } from "./prescriptionBranding";

export function VisualPrescriptionDesigner({ value, doctor, saving, onSave, onCancel, names }: { value: PrescriptionTemplate | null; doctor?: Doctor | null; saving: boolean; onSave: (template: PrescriptionTemplate) => void; onCancel?: () => void; names?: { ar?: string; fr?: string } }) {
  const fr = useLanguage() === "fr";
  const t = (ar: string, french: string) => fr ? french : ar;
  const branding = useMemo(() => prescriptionBranding(doctor), [doctor]);
  const [design, setDesign] = useState<PrescriptionDesign>(() => {
    if (value?.design && value.design.source !== "image") {
      // Reflow generated stationery in the editor; saving remains an explicit action.
      return canBalancePrescriptionDesign(value.design)
        ? arrangeSimpleHeader(value.design, readSimpleHeader(value.design, names)) : value.design;
    }
    const base: PrescriptionDesign = { version: 1, source: "generated", printMode: value?.design?.printMode ?? "blank", language: fr ? "fr" : "ar", doctorName: doctor ? `${doctor.firstName} ${doctor.lastName}` : "", specialty: (fr ? doctor?.specialty?.nameFr : doctor?.specialty?.nameAr) || "", clinicName: doctor?.clinic?.nameAr || "", address: doctor?.clinic?.address || doctor?.address || "", phone: doctor?.clinic?.phone || doctor?.phone || "", footer: "", color: "#187f77", layout: "split", logo: null, logoPosition: "center", headerSize: 18 };
    return arrangeSimpleHeader(base, { ...readSimpleHeader(base, names), specialty: doctor?.specialty?.nameAr || "", specialtyFr: doctor?.specialty?.nameFr || "" });
  });
  const [preview, setPreview] = useState<PrescriptionTemplate | null>(value?.design?.source !== "image" ? value : null);
  const [changed, setChanged] = useState(!value?.design || value.design.source === "image" || JSON.stringify(design) !== JSON.stringify(value.design));
  const [rendering, setRendering] = useState(true), [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const simple = readSimpleHeader(design, names);
  const disabled = saving || uploading;
  const incomplete = !simple.nameAr.trim() && !simple.nameFr.trim();
  const overlap = Boolean(changed && design.elements?.some(e => overlapsWritingArea(e, design.writingArea ?? { top: 60, bottom: 30, side: 12 })));
  function update(patch: Partial<SimplePrescriptionHeader>, logo = design.logo) {
    setChanged(true);
    setDesign(arrangeSimpleHeader({ ...design, source: "generated", logo }, { ...simple, ...patch }));
  }
  useEffect(() => {
    if (!changed && value) { setPreview({ ...value, design }); setRendering(false); return; }
    let alive = true; setRendering(true); setError(""); setPreview(null);
    const timer = window.setTimeout(() => {
      renderPrescriptionDesign(design, branding).then(result => { if (alive) setPreview(result); }).catch(e => { if (alive) setError((e as Error).message); }).finally(() => { if (alive) setRendering(false); });
    }, 150);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [design, changed, value, branding]);
  const ready = !disabled && !rendering && !!preview && !overlap && !incomplete && !error;
  return <div className="space-y-4">
    <p className="text-sm text-slate-600">{t("أدخل بياناتك؛ نرتب الورقة والشعار تلقائيًا. القالب الحالي لا يتغير إلا عند الحفظ.", "Renseignez vos informations : mise en page automatique. Le modèle actuel reste inchangé jusqu’à l’enregistrement.")}</p>
    <div className="grid gap-4 md:grid-cols-2">
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="mb-2 font-bold">{t("بيانات الطبيب والعيادة", "Médecin et cabinet")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">{([{ key: "nameAr", label: t("اسم الطبيب بالعربية", "Nom en arabe"), dir: "rtl", max: 120 }, { key: "nameFr", label: t("اسم الطبيب بالفرنسية", "Nom en français"), dir: "ltr", max: 120 }, { key: "specialty", label: t("التخصص بالعربية", "Spécialité en arabe"), dir: "auto", max: 120 }, { key: "specialtyFr", label: t("التخصص بالفرنسية", "Spécialité en français"), dir: "ltr", max: 120 }, { key: "clinic", label: t("العيادة بالعربية", "Cabinet en arabe"), dir: "auto", max: 120 }, { key: "clinicFr", label: t("العيادة بالفرنسية", "Cabinet en français"), dir: "ltr", max: 120 }, { key: "address", label: t("العنوان بالعربية", "Adresse en arabe"), dir: "auto", max: 180 }, { key: "addressFr", label: t("العنوان بالفرنسية", "Adresse en français"), dir: "ltr", max: 180 }, { key: "phone", label: t("الهاتف", "Téléphone"), dir: "ltr", max: 60 }, { key: "footer", label: t("معلومات أسفل الورقة (اختياري)", "Pied de page (facultatif)"), dir: "auto", max: 240 }] as const).map(field => <label key={field.key} className="block text-sm">{field.label}<input className="input mt-1 w-full" dir={field.dir} maxLength={field.max} value={simple[field.key]} onChange={e => update({ [field.key]: e.target.value })} /></label>)}</div>
        <p className="text-xs text-slate-500">{t("اكتب الاسم كما تريد ظهوره؛ لا نترجمه تلقائيًا.", "Saisissez les noms souhaités, sans traduction automatique.")}</p>
        <label className="block text-sm">{t("شعار الطبيب (وإلا يظهر شعار التخصص)", "Logo du médecin (sinon : spécialité)")}<input className="mt-1 block w-full" type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          setUploading(true); setError("");
          try { update({}, await readPrescriptionLogo(file)); } catch (err) { setError((err as Error).message); } finally { setUploading(false); }
        }} /></label>
        {design.logo && <button type="button" className="btn-outline" onClick={() => update({}, null)}>{t("إزالة الشعار", "Retirer le logo")}</button>}
        <label className="block text-sm">{t("الطباعة على", "Imprimer sur")}<select className="input mt-1 w-full" value={design.printMode ?? "blank"} onChange={e => setDesign({ ...design, printMode: e.target.value as "blank" | "preprinted" })}><option value="blank">{t("ورق أبيض — طباعة الترويسة والمحتوى", "Papier blanc — fond et contenu")}</option><option value="preprinted">{t("ورق مطبوع مسبقًا — المحتوى فقط", "Papier préimprimé — contenu seul")}</option></select></label>
      </fieldset>
      <div className="min-w-0 rounded-xl bg-slate-100 p-3">
        {preview && <img src={preview.image} alt={t("معاينة القالب A5", "Aperçu du modèle A5")} className="mx-auto w-full max-w-sm border bg-white shadow" />}
        {rendering && <p role="status">{t("جارٍ تحديث المعاينة…", "Mise à jour…")}</p>}
        <p className="mt-2 text-center text-xs text-slate-600">A5 · {t("تظهر الخلفية في المعاينة في وضعي الطباعة", "Le fond reste visible dans les deux modes")}</p>
      </div>
    </div>
    {overlap && <p role="alert" className="text-amber-800">{t("عنصر من التصميم القديم يتداخل مع مساحة الكتابة. احتفظنا به ولم نحذفه؛ لم يُحفظ التعديل. يلزم مراجعة توافق هذا القالب.", "Un élément ancien recouvre la zone de contenu. Il est conservé ; la modification ne peut pas être enregistrée sans vérification.")}</p>}
    {incomplete && <p role="alert">{t("أدخل اسم الطبيب بإحدى اللغتين.", "Saisissez le nom dans une des langues.")}</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-outline" disabled={!ready} onClick={() => setTestOpen(true)}>{t("طباعة اختبار", "Impression test")}</button>
      <button type="button" className="btn-primary" disabled={!ready} onClick={() => { if (preview) onSave(preview); }}>{saving ? t("جارٍ الحفظ…", "Enregistrement…") : t("حفظ القالب", "Enregistrer")}</button>
      <button type="button" className="btn-outline" disabled={disabled} onClick={onCancel}>{t("إلغاء", "Annuler")}</button>
    </div>
    <PrescriptionPreview open={testOpen} onClose={() => setTestOpen(false)} data={preview ? { template: preview, doctor, language: fr ? "fr" : "ar", patientName: t("مريض تجريبي", "Patient test"), day: "2026-10-14", medications: [], notes: t("نص تجريبي للتحقق من موضع الكتابة. لا يحتوي بيانات مرضى.", "Texte de test pour vérifier la position du contenu. Aucune donnée patient.") } : null} />
  </div>;
}
