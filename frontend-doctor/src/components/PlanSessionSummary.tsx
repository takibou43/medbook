import { useLanguage } from "../i18n/LanguageRoot";
import { t } from "../i18n/locale.ts";

export function PlanSessionSummary({ estimated, added, completed }: { estimated?: number | null; added: number; completed: number }) {
  useLanguage();
  return <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
    <span>{t("عدد الجلسات التقديري")}: {estimated ?? t("غير محدد")}</span>
    <span>{t("الجلسات المضافة")}: {added}</span>
    <span>{t("الجلسات المكتملة")}: {completed}</span>
  </span>;
}
