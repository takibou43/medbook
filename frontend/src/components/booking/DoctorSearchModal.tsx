import { useEffect } from "react";
import { X } from "lucide-react";
import { t } from "../../i18n/locale.ts";
import { useLanguage } from "../../i18n/LanguageRoot";
import type { Doctor } from "../../types";
import { DoctorNameSearch } from "./DoctorNameSearch";
import { useDialogFocus } from "./useDialogFocus";

export function DoctorSearchModal({ onClose, onSelect }: { onClose: () => void; onSelect: (doctor: Doctor) => void }) {
  useLanguage();
  const dialogRef = useDialogFocus(onClose);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  return (
    <div className="motion-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 pt-6 sm:p-6 sm:pt-16" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="doctor-search-title" className="motion-pop max-h-[90svh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-pop" onClick={event => event.stopPropagation()}>
        <div className="flex justify-end px-3 pt-2">
          <button type="button" onClick={onClose} aria-label={t("إغلاق")} className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <DoctorNameSearch onSelect={onSelect} />
      </div>
    </div>
  );
}
