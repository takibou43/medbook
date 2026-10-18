import { useEffect, useState } from "react";
import { applyPrescriptionPreset, PRESCRIPTION_PRESETS, readSimpleHeader, arrangeSimpleHeader, renderPrescriptionDesign, type PrescriptionBranding, type PrescriptionDesign, type PrescriptionPreset } from "../../lib/prescriptionDesign";

export function PrescriptionPresetPicker({ design, branding, french, disabled, onSelect }: {
  design: PrescriptionDesign; branding: PrescriptionBranding; french: boolean; disabled: boolean; onSelect: (preset: PrescriptionPreset) => void;
}) {
  const [previousOpen, setPreviousOpen] = useState(false);
  const [images, setImages] = useState<Partial<Record<PrescriptionPreset, string>>>({});
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      const fields = readSimpleHeader(design);
      const sample = arrangeSimpleHeader(design, { ...fields, nameAr: fields.nameAr || "اسم الطبيب", nameFr: fields.nameFr || "Nom du médecin" });
      const choices = previousOpen ? PRESCRIPTION_PRESETS : PRESCRIPTION_PRESETS.filter(p => p.id === "traditional");
      const results = await Promise.all(choices.map(async p => {
        try { return [p.id, (await renderPrescriptionDesign(applyPrescriptionPreset(sample, p.id), branding)).image] as const; }
        catch { return [p.id, undefined] as const; }
      }));
      if (alive) setImages(Object.fromEntries(results));
    }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [design, branding, previousOpen]);
  const card = (preset: typeof PRESCRIPTION_PRESETS[number]) => <button key={preset.id} type="button" aria-pressed={design.preset === preset.id} onClick={() => onSelect(preset.id)}
    className={`min-w-0 rounded border-2 p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${design.preset === preset.id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-400"}`}>
    {images[preset.id] ? <img src={images[preset.id]} alt="" className="mx-auto mb-2 h-44 border bg-white object-contain" /> : <span className="mb-2 flex h-44 items-center justify-center text-slate-500">A5</span>}
    <span className="block font-semibold">{french ? preset.fr : preset.ar}</span>
  </button>;
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="font-bold">{french ? "Modèle de votre ordonnance" : "شكل الوصفة"}</legend>
    <p className="text-xs text-slate-600">{french ? "Aperçus réels de votre papier à en-tête. Le modèle enregistré ne change qu’après sauvegarde." : "معاينات فعلية لترويسة وصفتك. لا يتغير القالب المحفوظ إلا بعد الحفظ."}</p>
    <div className="grid max-w-sm grid-cols-1">{card(PRESCRIPTION_PRESETS[0])}</div>
    <details open={previousOpen} onToggle={e => setPreviousOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm text-slate-600">{french ? "Autres mises en page" : "تخطيطات أخرى"}</summary>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{PRESCRIPTION_PRESETS.slice(1).map(card)}</div>
    </details>
  </fieldset>;
}
