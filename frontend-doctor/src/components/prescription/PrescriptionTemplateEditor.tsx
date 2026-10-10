import { useState } from "react";
import { api } from "../../lib/api";
import { readTemplateImage, type PrescriptionTemplate } from "../../lib/prescriptionTemplate";
import { useLanguage } from "../../i18n/LanguageRoot";

export function PrescriptionTemplateEditor({ value, onChange }: { value: PrescriptionTemplate | null; onChange: (value: PrescriptionTemplate | null) => void }) {
  const fr = useLanguage() === "fr";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(remove = false) {
    setBusy(true); setError("");
    try {
      if (remove) await api.delete("/doctor/prescription-template");
      else await api.put("/doctor/prescription-template", draft);
      onChange(remove ? null : draft); setEditing(false);
    } catch { setError(fr ? "Enregistrement impossible. Réessayez." : "تعذر حفظ القالب. أعد المحاولة."); }
    finally { setBusy(false); }
  }
  return <div className="my-3 rounded-xl border border-slate-200 p-3">
    <button type="button" className="btn-outline" onClick={() => { setDraft(value); setError(""); setEditing(!editing); }}>{fr ? "Modèle personnel A5" : "قالب الوصفة الشخصي A5"}</button>
    {value && <span className="mx-2 text-sm text-emerald-700">{fr ? "Enregistré dans votre compte" : "محفوظ في حسابك"}</span>}
    {editing && <div className="mt-3 space-y-3">
      <p className="text-sm text-slate-600">{fr ? "Importez une ordonnance vierge, sans données de patient. Photo verticale de toute la feuille A5, puis réglez la zone d’écriture (mm)." : "ارفع صورة وصفة فارغة دون بيانات مرضى. صوّر ورقة A5 كاملة بشكل مستقيم، ثم اضبط مساحة الكتابة بالميليمتر."}</p>
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-label={fr ? "Image du modèle vierge" : "صورة قالب الوصفة الفارغة"} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        setBusy(true); setError("");
        try { const image = await readTemplateImage(file); setDraft({ image, top: draft?.top ?? 40, bottom: draft?.bottom ?? 30, side: draft?.side ?? 12 }); }
        catch (err) { setError(fr ? "Image invalide. Utilisez une image A5 verticale PNG, JPEG ou WebP (5 Mo maximum)." : (err as Error).message); }
        finally { setBusy(false); }
      }} />
      {draft && <>
        <div className="flex flex-wrap gap-3">{(["top", "bottom", "side"] as const).map(key => <label key={key} className="text-sm">{({ top: fr ? "Marge haute" : "الهامش العلوي", bottom: fr ? "Marge basse" : "الهامش السفلي", side: fr ? "Marges latérales" : "الهوامش الجانبية" })[key]}
          <input type="range" className="block" min={key === "side" ? 5 : 10} max={key === "top" ? 75 : key === "bottom" ? 60 : 30} value={draft[key]} disabled={busy} onChange={e => setDraft({ ...draft, [key]: Number(e.target.value) })} /><span dir="ltr">{draft[key]} mm</span>
        </label>)}</div>
        <div className="relative mx-auto border bg-white" style={{ width: 222, height: 315 }}>
          <img src={draft.image} alt="" className="absolute inset-0 h-full w-full" />
          <div className="absolute border-2 border-dashed border-teal-600 bg-white/30 text-center text-xs text-teal-900" style={{ top: draft.top * 1.5, bottom: draft.bottom * 1.5, left: draft.side * 1.5, right: draft.side * 1.5 }}>{fr ? "Zone d’écriture" : "مساحة الكتابة"}</div>
        </div>
        <button type="button" disabled={busy} className="btn-primary" onClick={() => save()}>{busy ? (fr ? "Enregistrement…" : "جارٍ الحفظ…") : (fr ? "Enregistrer le modèle" : "حفظ القالب")}</button>
      </>}
      {value && <button type="button" disabled={busy} className="btn-outline mx-2" onClick={() => save(true)}>{fr ? "Supprimer le modèle" : "حذف القالب"}</button>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>}
  </div>;
}
