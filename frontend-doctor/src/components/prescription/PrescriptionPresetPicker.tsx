import { PRESCRIPTION_PRESETS, type PrescriptionPreset } from "../../lib/prescriptionDesign";

export function PrescriptionPresetPicker({ selected, french, disabled, onSelect }: {
  selected?: PrescriptionPreset; french: boolean; disabled: boolean; onSelect: (preset: PrescriptionPreset) => void;
}) {
  return <fieldset disabled={disabled} className="min-w-0 space-y-2">
    <legend className="font-bold">{french ? "Choisir un modèle A5" : "اختر قالب A5"}</legend>
    <p className="text-xs text-slate-600">{french ? "Vos noms, coordonnées et logo sont conservés. Le choix reste provisoire jusqu’à l’enregistrement." : "نحتفظ بالاسم وبيانات العيادة والشعار. لا يُعتمد الاختيار إلا عند حفظ القالب."}</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {PRESCRIPTION_PRESETS.map(preset => <button key={preset.id} type="button" aria-pressed={selected === preset.id} onClick={() => onSelect(preset.id)}
        className={`min-w-0 rounded-xl border-2 p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${selected === preset.id ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-400"}`}>
        <svg viewBox="0 0 148 210" aria-hidden="true" className="mx-auto mb-2 h-32 max-w-full border bg-white shadow-sm">
          {preset.id === "specialty" && <><path d="M8 4H140" stroke={preset.color} strokeWidth="3" /><path d="M8 6H140V39H8Z" fill={preset.color} opacity=".07" /></>}
          <circle cx="74" cy={preset.id === "centered" ? 16 : 20} r={preset.id === "centered" ? 9 : 11} fill={preset.color} opacity=".15" />
          <path d={preset.id === "centered" ? "M30 33H62 M86 33H118 M30 40H62 M86 40H118 M30 47H62 M86 47H118" : "M10 13H50 M98 13H138 M10 21H45 M103 21H138 M10 29H48 M100 29H138"} stroke={preset.color} strokeWidth="2" />
          <path d={`M8 ${preset.id === "centered" ? 57 : 39}H140 M8 189H140`} stroke={preset.color} strokeWidth=".8" />
          <g stroke="#94a3b8" strokeWidth="2"><path d="M16 75H90 M16 82H117 M16 100H85 M16 107H112 M16 125H88 M16 132H106" /></g>
          <path d="M10 197H47 M99 197H138" stroke={preset.color} strokeWidth="2" />
          <rect x="69" y="193" width="10" height="10" fill={preset.color} opacity=".4" />
        </svg>
        <span className="block font-semibold">{french ? preset.fr : preset.ar}</span>
      </button>)}
    </div>
  </fieldset>;
}
