import { useLanguage } from "../../i18n/LanguageRoot";
import { t, catalogName } from "../../i18n/locale.ts";
import { useWilayas } from "../../hooks/useCatalog";

export function RegionFilters({ wilayaId, cityId, onChange }: {
  wilayaId: string; cityId: string;
  onChange: (wilayaId: string, cityId: string) => void;
}) {
  useLanguage();
  const { data: wilayas, isError, refetch } = useWilayas();
  return <fieldset className="my-3 space-y-2">
    <legend className="text-sm font-semibold">{t("البحث حسب المنطقة")}</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      <label><span className="label">{t("الولاية")}</span><select className="input min-h-[48px]" value={wilayaId} onChange={e => onChange(e.target.value, "")}>
        <option value="">{t("كل الولايات")}</option>
        {wilayas?.map(w => <option key={w.id} value={w.id}>{catalogName(w)}</option>)}
      </select></label>
      <label><span className="label">{t("البلدية")}</span><select className="input min-h-[48px]" value={cityId} disabled={!wilayaId} onChange={e => onChange(wilayaId, e.target.value)}>
        <option value="">{t("كل البلديات")}</option>
        {wilayas?.find(w => w.id === wilayaId)?.cities?.map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
      </select></label>
    </div>
    {isError && <p role="alert">{t("تعذّر تحميل المناطق. ")}<button type="button" className="btn-outline" onClick={() => void refetch()}>{t("إعادة المحاولة")}</button></p>}
  </fieldset>;
}
