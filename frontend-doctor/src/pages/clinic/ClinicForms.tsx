import { useState } from "react";
import { Input, Select } from "../../components/ui/Input";
import { useSpecialties, useWilayas } from "../../hooks/useCatalog";
export interface ClinicProfile { nameAr: string; address: string; phone?: string | null; wilayaId: string; cityId: string; description?: string | null; photoUrl?: string | null }
export function profileFromForm(form: FormData) {
  return Object.fromEntries(["nameAr", "address", "phone", "wilayaId", "cityId", "description", "photoUrl"].flatMap(k => {
    const value = String(form.get(k) || "").trim(); return value ? [[k, value]] : [];
  }));
}
export function doctorFromForm(form: FormData) {
  return { firstName: String(form.get("firstName") || ""), lastName: String(form.get("lastName") || ""), specialtyId: String(form.get("specialtyId") || "") };
}
export function ClinicProfileFields({ initial }: { initial?: ClinicProfile }) {
  const { data: wilayas } = useWilayas();
  const [wilayaId, setWilayaId] = useState(initial?.wilayaId || "");
  const [cityId, setCityId] = useState(initial?.cityId || "");
  return <>
    <Input name="nameAr" label="اسم العيادة" defaultValue={initial?.nameAr} required minLength={2} maxLength={150} />
    <Input name="address" label="عنوان العيادة" defaultValue={initial?.address} required minLength={3} maxLength={500} />
    <Input name="phone" label="هاتف العيادة" defaultValue={initial?.phone || ""} minLength={9} maxLength={20} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Select name="wilayaId" label="الولاية" value={wilayaId} onChange={e => { setWilayaId(e.target.value); setCityId(""); }} required>
        <option value="">اختر الولاية</option>{wilayas?.map(w => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
      </Select>
      <Select name="cityId" label="المدينة" value={cityId} onChange={e => setCityId(e.target.value)} required>
        <option value="">اختر المدينة</option>{wilayas?.find(w => w.id === wilayaId)?.cities?.map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
      </Select>
    </div>
    <Input name="description" label="نبذة عن العيادة" defaultValue={initial?.description || ""} maxLength={2000} />
    <Input name="photoUrl" label="رابط صورة العيادة (اختياري)" type="url" defaultValue={initial?.photoUrl || ""} placeholder="https://" />
  </>;
}
export function DoctorProfileFields() {
  const { data: specialties } = useSpecialties();
  return <>
    <div className="grid grid-cols-2 gap-3"><Input name="firstName" label="اسم الطبيب" required minLength={2} /><Input name="lastName" label="لقب الطبيب" required minLength={2} /></div>
    <Select name="specialtyId" label="التخصص" required><option value="">اختر التخصص</option>{specialties?.map(s => <option key={s.id} value={s.id}>{s.nameAr}</option>)}</Select>
  </>;
}
