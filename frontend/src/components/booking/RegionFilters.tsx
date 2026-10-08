import { useWilayas } from "../../hooks/useCatalog";

export function RegionFilters({ wilayaId, cityId, onChange }: {
  wilayaId: string; cityId: string;
  onChange: (wilayaId: string, cityId: string) => void;
}) {
  const { data: wilayas, isError, refetch } = useWilayas();
  return <fieldset className="my-3 space-y-2">
    <legend className="text-sm font-semibold">البحث حسب المنطقة</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      <label><span className="label">الولاية</span><select className="input min-h-[48px]" value={wilayaId} onChange={e => onChange(e.target.value, "")}>
        <option value="">كل الولايات</option>
        {wilayas?.map(w => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
      </select></label>
      <label><span className="label">البلدية</span><select className="input min-h-[48px]" value={cityId} disabled={!wilayaId} onChange={e => onChange(wilayaId, e.target.value)}>
        <option value="">كل البلديات</option>
        {wilayas?.find(w => w.id === wilayaId)?.cities?.map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
      </select></label>
    </div>
    {isError && <p role="alert">تعذّر تحميل المناطق. <button type="button" className="btn-outline" onClick={() => void refetch()}>إعادة المحاولة</button></p>}
  </fieldset>;
}
