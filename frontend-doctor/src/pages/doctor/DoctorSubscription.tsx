import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { MessageSquare } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { ErrorState, Spinner } from "../../components/ui/States";
import { formatDayAr } from "../../lib/doctorUi";
import { TONE_CLASS, subscriptionBadge, subscriptionDetails, type SubscriptionSummary } from "../../lib/doctorHeader";

/**
 * تفاصيل الاشتراك الكاملة (انتقلت من رأس لوحة التحكم التي تعرض شارة مختصرة فقط).
 * قراءة فقط: لا ترقية ولا دفع هنا — لا بوابة دفع في المنصة، والتفعيل/التجديد عبر الإدارة. الحالة من
 * GET /doctor/dashboard (الـ Backend هو المصدر)، ولا نعرض مدة أو تاريخًا إلا إن وُجد في السجل.
 */
export default function DoctorSubscription() {
  useLanguage();
  const stats = useQuery({
    queryKey: ["doctor-dashboard"],
    queryFn: async () => (await api.get("/doctor/dashboard")).data.data,
  });
  const summary: SubscriptionSummary | null = stats.data?.subscription ?? null;
  const badge = subscriptionBadge(summary);
  const details = summary ? subscriptionDetails(summary, (day) => formatDayAr(day)) : null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-900">{t("الاشتراك")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("حالة اشتراكك وتفاصيله")}</p>
      </header>

      {stats.isPending ? (
        <Spinner />
      ) : stats.isError ? (
        <ErrorState message={apiErrorMessage(stats.error)} onRetry={() => void stats.refetch()} />
      ) : !summary || !details || !badge ? (
        <p className="card p-4 text-sm text-slate-600">{t("لا تتوفر بيانات الاشتراك الآن.")}</p>
      ) : (
        <section className="card space-y-3 p-4 sm:p-5" aria-label={t("تفاصيل الاشتراك")}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-lg font-bold text-slate-900">{details.headline}</h2>
            <span className={clsx("badge whitespace-nowrap", TONE_CLASS[badge.tone])}>{badge.label}</span>
          </div>
          <ul className="space-y-1.5 text-sm text-slate-700">
            {details.lines.map((line) => (
              <li key={line} className="break-words">{line}</li>
            ))}
          </ul>
          {details.needsAdminContact && (
            <Link to="/messages" className="btn-outline w-full sm:w-auto">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              {t("مراسلة الإدارة للتفعيل أو التجديد")}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
