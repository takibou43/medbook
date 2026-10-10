import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
import { useState } from "react";
import { Input, Select } from "../../components/ui/Input";
import { useWilayas } from "../../hooks/useCatalog";
import { SpecialtyInput } from "../../components/SpecialtyInput";
export interface ClinicProfile { nameAr: string; address: string; phone?: string | null; wilayaId: string; cityId: string; description?: string | null; photoUrl?: string | null }
export function profileFromForm(form: FormData) {
  return Object.fromEntries(["nameAr", "address", "phone", "wilayaId", "cityId", "description", "photoUrl"].flatMap(k => {
    const value = String(form.get(k) || "").trim(); return value ? [[k, value]] : [];
  }));
}
export function doctorFromForm(form: FormData) {
  return { firstName: String(form.get("firstName") || ""), lastName: String(form.get("lastName") || ""), specialtyName: String(form.get("specialtyName") || "") };
}
export function ClinicProfileFields({ initial }: { initial?: ClinicProfile }) {
  useLanguage();
  const { data: wilayas } = useWilayas();
  const [wilayaId, setWilayaId] = useState(initial?.wilayaId || "");
  const [cityId, setCityId] = useState(initial?.cityId || "");
  return <>
    <Input name="nameAr" label={t("اسم العيادة")} defaultValue={initial?.nameAr} required minLength={2} maxLength={150} />
    <Input name="address" label={t("عنوان العيادة")} defaultValue={initial?.address} required minLength={3} maxLength={500} />
    <Input name="phone" label={t("هاتف العيادة")} defaultValue={initial?.phone || ""} minLength={9} maxLength={20} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Select name="wilayaId" label={t("الولاية")} value={wilayaId} onChange={e => { setWilayaId(e.target.value); setCityId(""); }} required>
        <option value="">{t("اختر الولاية")}</option>{wilayas?.map(w => <option key={w.id} value={w.id}>{catalogName(w)}</option>)}
      </Select>
      <Select name="cityId" label={t("المدينة")} value={cityId} onChange={e => setCityId(e.target.value)} required>
        <option value="">{t("اختر المدينة")}</option>{wilayas?.find(w => w.id === wilayaId)?.cities?.map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
      </Select>
    </div>
    <Input name="description" label={t("نبذة عن العيادة")} defaultValue={initial?.description || ""} maxLength={2000} />
    <Input name="photoUrl" label={t("رابط صورة العيادة (اختياري)")} type="url" defaultValue={initial?.photoUrl || ""} placeholder="https://" />
  </>;
}
export function DoctorProfileFields() {
  useLanguage();
  return <>
    <div className="grid grid-cols-2 gap-3"><Input name="firstName" label={t("اسم الطبيب")} required minLength={2} /><Input name="lastName" label={t("لقب الطبيب")} required minLength={2} /></div>
    <SpecialtyInput name="specialtyName" />
  </>;
}
