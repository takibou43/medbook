import { useEffect, useState } from "react";
import type { Doctor } from "../../types";
import { useLanguage } from "../../i18n/LanguageRoot";
import { readPrescriptionLogo, renderPrescriptionDesign, type PrescriptionDesign } from "../../lib/prescriptionDesign";
import type { PrescriptionTemplate } from "../../lib/prescriptionTemplate";

export function PrescriptionDesigner({ value, doctor, saving, onSave }: { value: PrescriptionTemplate | null; doctor?: Doctor | null; saving: boolean; onSave: (template: PrescriptionTemplate) => void }) {
  const fr = useLanguage() === "fr";
  const [design, setDesign] = useState<PrescriptionDesign>(() => value?.design ?? {
    version: 1, language: fr ? "fr" : "ar", doctorName: doctor ? `${doctor.firstName} ${doctor.lastName}` : "", specialty: (fr ? doctor?.specialty?.nameFr : doctor?.specialty?.nameAr) || doctor?.specialty?.nameAr || "",
    clinicName: doctor?.clinic?.nameAr || "", address: doctor?.clinic?.address || doctor?.address || "", phone: doctor?.clinic?.phone || doctor?.phone || "", footer: "", color: "#187f77", layout: "split", logo: null, logoPosition: "left", headerSize: 18,
  });
  const [preview, setPreview] = useState<PrescriptionTemplate | null>(null);
  const [rendering, setRendering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [logoError, setLogoError] = useState("");
  const patch = (next: Partial<PrescriptionDesign>) => setDesign(current => ({ ...current, ...next }));
  useEffect(() => {
    let active = true;
    setRendering(true); setError(""); setPreview(null);
    const timer = window.setTimeout(() => {
      renderPrescriptionDesign(design).then(result => { if (active) setPreview(result); }).catch(err => { if (active) setError((err as Error).message); }).finally(() => { if (active) setRendering(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [design]);
  const fields: { key: "doctorName" | "specialty" | "clinicName" | "address" | "phone" | "footer"; label: string; max: number }[] = [
    { key: "doctorName", label: fr ? "Nom du médecin" : "اسم الطبيب", max: 120 },
    { key: "specialty", label: fr ? "Spécialité" : "التخصص", max: 120 },
    { key: "clinicName", label: fr ? "Nom du cabinet" : "اسم العيادة", max: 120 },
    { key: "address", label: fr ? "Adresse" : "العنوان", max: 180 },
    { key: "phone", label: fr ? "Téléphone" : "الهاتف", max: 60 },
    { key: "footer", label: fr ? "Pied de page" : "تذييل الورقة", max: 240 },
  ];
  const disabled = saving || uploading;
  return <div className="space-y-3">
    <p className="text-sm text-slate-600">{fr ? "Créez votre papier à en-tête. Seuls le modèle vierge et ses réglages sont enregistrés. Le texte de la prescription sera ajouté lors de l’impression." : "صمّم ورقة وصفتك وعدّلها متى شئت. يُحفظ القالب الفارغ وإعداداته فقط، وتُضاف بيانات الوصفة عند الطباعة."}</p>
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="sr-only">{fr ? "Conception de l’ordonnance" : "تصميم الوصفة"}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(field => <label key={field.key} className="block text-sm font-semibold">{field.label}<input className="input mt-1 w-full" dir="auto" value={design[field.key]} maxLength={field.max} required={field.key === "doctorName"} onChange={e => patch({ [field.key]: e.target.value })} /></label>)}
        <label className="block text-sm font-semibold">{fr ? "Langue du modèle" : "لغة القالب"}<select className="input mt-1 w-full" value={design.language} onChange={e => patch({ language: e.target.value as "ar" | "fr" })}><option value="ar">العربية</option><option value="fr">Français</option></select></label>
        <label className="block text-sm font-semibold">{fr ? "Disposition" : "التخطيط"}<select className="input mt-1 w-full" value={design.layout} onChange={e => patch({ layout: e.target.value as "split" | "centered" })}><option value="split">{fr ? "En-tête latéral" : "ترويسة جانبية"}</option><option value="centered">{fr ? "En-tête centré" : "ترويسة وسطية"}</option></select></label>
        <label className="block text-sm font-semibold">{fr ? "Couleur" : "لون الترويسة"}<input className="mt-1 block h-11 w-20" type="color" value={design.color} onChange={e => patch({ color: e.target.value })} /></label>
        <label className="block text-sm font-semibold">{fr ? "Taille de l’en-tête" : "حجم الترويسة"}<input type="range" className="mt-2 block w-full" min="14" max="22" step="1" value={design.headerSize} onChange={e => patch({ headerSize: Number(e.target.value) })} /><span>{design.headerSize}</span></label>
      </div>
      <label className="block text-sm font-semibold">{fr ? "Votre logo" : "شعارك الخاص"}<input className="mt-1 block w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
        setUploading(true); setLogoError("");
        try { patch({ logo: await readPrescriptionLogo(file) }); }
        catch (err) { setLogoError(fr ? "Image invalide. Utilisez un logo PNG, JPEG ou WebP de 5 Mo maximum." : (err as Error).message); }
        finally { setUploading(false); }
      }} /></label>
      {design.logo && <div className="flex flex-wrap items-center gap-3">
        <img src={design.logo} alt={fr ? "Logo choisi" : "الشعار المختار"} className="h-16 w-16 object-contain" />
        <button type="button" className="btn-outline" onClick={() => patch({ logo: null })}>{fr ? "Retirer le logo" : "إزالة الشعار"}</button>
        {design.layout === "split" && <label className="min-w-0 text-sm">{fr ? "Position du logo" : "موضع الشعار"}<select className="input mt-1 w-full" value={design.logoPosition} onChange={e => patch({ logoPosition: e.target.value as "left" | "right" })}><option value="left">{fr ? "À gauche" : "يسار"}</option><option value="right">{fr ? "À droite" : "يمين"}</option></select></label>}
      </div>}
    </fieldset>
    {logoError && <p role="alert" className="text-sm text-red-700">{logoError}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {rendering && <p role="status" className="text-sm text-slate-600">{fr ? "Préparation de l’aperçu…" : "جارٍ تجهيز المعاينة…"}</p>}
    {preview && <figure className="mx-auto w-fit"><div className="relative border bg-white" style={{ width: 222, height: 315 }}>
      <img src={preview.image} alt={fr ? "Aperçu du modèle A5 personnalisé" : "معاينة قالب A5 المصمم"} className="absolute inset-0 h-full w-full" />
      <div className="absolute border border-dashed border-teal-600 text-center text-xs text-teal-800" style={{ top: preview.top * 1.5, bottom: preview.bottom * 1.5, left: preview.side * 1.5, right: preview.side * 1.5 }}>{fr ? "Zone de prescription" : "مساحة بيانات الوصفة"}</div>
    </div><figcaption className="mt-1 text-center text-xs text-slate-500">A5 · 148 × 210 mm</figcaption></figure>}
    <button type="button" className="btn-primary" disabled={disabled || rendering || !preview} onClick={() => { if (preview) onSave(preview); }}>{saving ? (fr ? "Enregistrement…" : "جارٍ الحفظ…") : (fr ? "Enregistrer mon design" : "حفظ تصميم وصفتي")}</button>
  </div>;
}
