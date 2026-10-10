import { ReactNode, useSyncExternalStore } from "react";
import { Languages } from "lucide-react";
import { getLanguage, setLanguage, subscribeLanguage } from "./locale.ts";

export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage);
}

export function LanguageRoot({ children }: { children: () => ReactNode }) {
  const language = useLanguage();
  const next = language === "ar" ? "fr" : "ar";
  const label = next === "fr" ? "Français" : "العربية";
  return <>
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setLanguage(next)}
      className="fixed bottom-24 end-3 z-40 flex h-11 w-11 flex-col items-center justify-center rounded-full border border-primary-200 bg-white/95 text-primary-700 shadow-md backdrop-blur-sm transition-colors hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 md:bottom-6 md:end-6"
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="text-[10px] font-bold leading-3" lang={next} dir={next === "ar" ? "rtl" : "ltr"}>{next === "fr" ? "FR" : "ع"}</span>
    </button>
    {children()}
  </>;
}
