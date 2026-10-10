import { useLanguage } from "../i18n/LanguageRoot";
import { t, catalogName } from "../i18n/locale.ts";
import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { Input } from "./ui/Input";
import { useSpecialties } from "../hooks/useCatalog";
import catalog from "../../../backend/src/data/algeria-specialties.json";

export const SpecialtyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: string }>((props, ref) => {
  const language = useLanguage();
  const { data: specialties } = useSpecialties();
  const listId = `specialties-${useId().replace(/:/g, "")}`;
  const names = [...new Set([...catalog.map(([ar, fr]) => language === "fr" ? fr : ar), ...(specialties ?? []).map(catalogName)])];
  return <>
    <Input {...props} ref={ref} label={t("التخصص")} list={listId} required minLength={2} maxLength={120} placeholder={t("اختر من القائمة أو اكتب اسم التخصص")} hint={t("يمكنك اختيار تخصص مقترح أو كتابة تخصصك بالعربية أو الفرنسية.")} />
    <datalist id={listId}>{names.map(name => <option key={name} value={name} />)}</datalist>
  </>;
});

