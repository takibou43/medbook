import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { Loader2, Inbox } from "lucide-react";

export function Spinner({ label = t("جارٍ التحميل...") }: { label?: string }) {
  useLanguage();
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-2 py-16 text-slate-600">
      <Loader2 className="h-8 w-8 animate-spin text-primary-500" aria-hidden="true" />
      <p className="text-sm">{t(label ?? "")}</p>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  useLanguage();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-slate-50 px-4 py-12 text-center">
      <Inbox className="h-10 w-10 text-slate-400" aria-hidden="true" />
      <p className="font-semibold text-slate-700">{t(title ?? "")}</p>
      {description && <p className="max-w-sm text-sm leading-relaxed text-slate-600">{t(description ?? "")}</p>}
    </div>
  );
}
