import { ReactNode, useSyncExternalStore } from "react";
import { Languages } from "lucide-react";
import { getLanguage, setLanguage, subscribeLanguage } from "./locale.ts";

export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage);
}

export function LanguageSwitcher({ floating = false }: { floating?: boolean }) {
  const language = useLanguage();
  const next = language === "ar" ? "fr" : "ar";
  const label = next === "fr" ? "Français" : "العربية";
  return <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setLanguage(next)}
      className={`glass-chrome flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full border border-primary-200 text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${floating ? "floating-language fixed bottom-24 end-3 z-40 md:bottom-6 md:end-6" : "dashboard-language"}`}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="text-[10px] font-bold leading-3" lang={next} dir={next === "ar" ? "rtl" : "ltr"}>{next === "fr" ? "FR" : "ع"}</span>
    </button>;
}

export function LanguageRoot({ children }: { children: () => ReactNode }) {
  useLanguage();
  return <><LanguageSwitcher floating />{children()}</>;
}
