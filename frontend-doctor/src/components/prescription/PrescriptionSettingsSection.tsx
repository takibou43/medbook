import { useEffect, useId, useState } from "react";
import { FileText } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { usePrescriptionSetup } from "../../hooks/usePrescriptionSetup";
import { DEFAULT_PRESCRIPTION_SETTINGS, sameSettings, type PrescriptionSettings } from "../../lib/prescriptionSettings";
import type { PrescriptionLanguage, PrescriptionProfessional } from "../../lib/prescriptionPrint";
import { Button } from "../ui/Button";
import { Spinner, ErrorState } from "../ui/States";
import { useToast } from "../ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { PrescriptionTemplateEditor } from "./PrescriptionTemplateEditor";
import { PrescriptionSheet } from "./PrescriptionPrint";

const PAPER_PX = (148 * 96) / 25.4;
const PREVIEW_SCALE = 0.62;
const FIELDS: { key: keyof PrescriptionProfessional; label: string }[] = [
  { key: "doctorName", label: "اسم الطبيب للطباعة" },
  { key: "clinicName", label: "اسم العيادة للطباعة" },
  { key: "address", label: "العنوان للطباعة" },
];
const SHOW: { key: keyof PrescriptionSettings["show"]; label: string }[] = [
  { key: "specialty", label: "إظهار التخصص" },
  { key: "clinicName", label: "إظهار اسم العيادة" },
  { key: "phone", label: "إظهار الهاتف" },
  { key: "address", label: "إظهار العنوان في أسفل الوصفة" },
];

/** «إعدادات الوصفة الطبية»: لغة الوصفة، البيانات المهنية، القالب A5 — محفوظة في حساب الطبيب وتُطبَّق على كل وصفة جديدة. */
export function PrescriptionSettingsSection() {
  useLanguage();
  const { user } = useAuth();
  const uid = user?.doctor ? user.id : "";
  const id = useId();
  const { showToast } = useToast();
  const setup = usePrescriptionSetup(uid);
  const [form, setForm] = useState<PrescriptionSettings>(DEFAULT_PRESCRIPTION_SETTINGS);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (setup.settings) setForm(setup.settings); }, [setup.settings]);
  if (!uid) return null;

  const dirty = Boolean(setup.settings) && !sameSettings(form, setup.settings!);
  const patchPro = (lang: PrescriptionLanguage, key: keyof PrescriptionProfessional, value: string) =>
    setForm(f => ({ ...f, professional: { ...f.professional, [lang]: { ...f.professional[lang], [key]: value } } }));

  async function save() {
    setSaving(true);
    try { await setup.saveSettings(form); showToast(t("تم حفظ إعدادات الوصفة."), "success"); }
    catch (err) { showToast(apiErrorMessage(err, t("تعذّر حفظ إعدادات الوصفة.")), "error"); }
    finally { setSaving(false); }
  }

  const lang = form.language;
  const sample = {
    language: lang,
    doctor: user?.doctor,
    professional: form.professional[lang],
    show: form.show,
    patientName: lang === "fr" ? "Nom du patient" : "اسم المريض",
    day: new Date().toISOString().slice(0, 10),
    medications: [{ id: "preview", name: lang === "fr" ? "Nom du médicament" : "اسم الدواء", dose: "", frequency: "", duration: "", instructions: "", directionsMode: "freeText" as const }],
    notes: "",
    logo: setup.template?.design?.logo ?? null,
  };

  return (
    <section className="card space-y-4 p-6" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-bold"><FileText className="h-5 w-5 text-primary-600" aria-hidden="true" /> {t("إعدادات الوصفة الطبية")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("تُحفظ في حسابك وتُطبَّق تلقائيًا على كل وصفة جديدة، فلا تحتاج لضبطها في كل مرة.")}</p>
      </div>

      {setup.loading ? <Spinner /> : setup.error || !setup.settings ? <ErrorState message={t("تعذّر تحميل إعدادات الوصفة.")} onRetry={setup.refetch} /> : (
        <>
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800">{t("الإعدادات العامة")}</h3>
            <label className="block">
              <span className="label">{t("لغة الوصفة الافتراضية")}</span>
              <select className="input" value={form.language} onChange={e => setForm({ ...form, language: e.target.value === "fr" ? "fr" : "ar" })}>
                <option value="ar">العربية</option><option value="fr">Français</option>
              </select>
              <span className="mt-1 block text-xs text-slate-500">{t("تغيير لغة الوصفة لا يغيّر لغة لوحة الطبيب أو النصوص التي كتبتها.")}</span>
            </label>

            <fieldset className="rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">{t("البيانات المهنية في رأس الوصفة")}</legend>
              <p className="mb-2 text-xs text-slate-600">{t("اترك الحقل فارغًا لاستخدام بياناتك الأصلية. لا تُحفظ في ملفك المهني ولا تُترجم الأسماء تلقائيًا.")}</p>
              {(["ar", "fr"] as const).map(l => (
                <div key={l} className="mb-3 last:mb-0">
                  <p className="mb-1 text-xs font-bold text-slate-700">{l === "ar" ? t("بالعربية") : t("بالفرنسية")}</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {FIELDS.map(f => (
                      <label key={f.key} className="block text-xs">
                        <span className="mb-1 block">{t(f.label)}</span>
                        <input className="input" dir="auto" translate="no" maxLength={f.key === "address" ? 180 : 120} value={form.professional[l]?.[f.key] ?? ""} onChange={e => patchPro(l, f.key, e.target.value)} />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>

            <fieldset className="rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">{t("البيانات الاختيارية في الوصفة")}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {SHOW.map(o => (
                  <label key={o.key} className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.show[o.key]} onChange={e => setForm({ ...form, show: { ...form.show, [o.key]: e.target.checked } })} /> {t(o.label)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <h3 className="mb-1 text-sm font-bold text-slate-800">{t("إعدادات الطباعة")}</h3>
              <p>{t("ورقة A5 عمودية ثابتة (148 × 210 مم) بهوامش 10 مم وخط واضح، واتجاه النص حسب لغة الوصفة. عند الطباعة اختر ورق A5 والحجم الفعلي 100% وألغِ الرؤوس والتذييلات.")}</p>
            </div>

            <PrescriptionTemplateEditor key={uid} value={setup.template} onChange={setup.setTemplate} doctor={user?.doctor} />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <Button type="button" onClick={save} loading={saving} disabled={!dirty}>{t("حفظ إعدادات الوصفة")}</Button>
            {dirty && <span role="status" className="text-xs text-amber-700">{t("لديك تغييرات غير محفوظة.")}</span>}
          </div>

          {!setup.template && (
            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-800">{t("معاينة شكل الوصفة")} <span className="font-normal text-slate-500">({t("نموذج توضيحي بدون بيانات مريض")})</span></h3>
              <div className="relative mx-auto overflow-hidden rounded border border-slate-200 bg-white shadow-sm" style={{ width: PAPER_PX * PREVIEW_SCALE, height: ((210 * 96) / 25.4) * PREVIEW_SCALE }} aria-hidden="true">
                <div className="rx-paper" style={{ position: "absolute", top: 0, left: 0, transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left", width: PAPER_PX, padding: "10mm", background: "#fff", boxShadow: "none", boxSizing: "border-box" }}>
                  <PrescriptionSheet data={sample} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
