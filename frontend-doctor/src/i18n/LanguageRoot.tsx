import { ReactNode, useSyncExternalStore } from "react";
import { getLanguage, setLanguage, subscribeLanguage } from "./locale.ts";

export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage);
}

export function LanguageRoot({ children }: { children: () => ReactNode }) {
  const language = useLanguage();
  return <>
    <div className="flex min-h-12 items-center justify-end gap-1 border-b border-slate-200 bg-white px-4" role="group" aria-label={language === "fr" ? "Langue de l’application" : "لغة التطبيق"}>
      <button type="button" lang="ar" dir="rtl" aria-pressed={language === "ar"} onClick={() => setLanguage("ar")} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${language === "ar" ? "bg-primary-50 text-primary-700" : "text-slate-600"}`}>العربية</button>
      <button type="button" lang="fr" dir="ltr" aria-pressed={language === "fr"} onClick={() => setLanguage("fr")} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${language === "fr" ? "bg-primary-50 text-primary-700" : "text-slate-600"}`}>Français</button>
    </div>
    {children()}
  </>;
}
