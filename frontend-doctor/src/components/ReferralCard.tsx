import { useLanguage } from "../i18n/LanguageRoot";
import { t } from "../i18n/locale.ts";
import { useQuery } from "@tanstack/react-query";
import { Copy, Gift, Share2 } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { useToast } from "./ui/Toast";
import { REFERRAL_STATUS_LABELS, referralLink } from "../lib/features";
import type { MyReferrals } from "../types";

/**
 * «ادعُ طبيبًا»: كود/رابط الإحالة وحالات الإحالات. عبارة «تمت إضافة 30 يومًا» لا تظهر إلا لإحالة
 * حالتها REWARDED في الخادم (أي بعد نجاح معاملة التمديد فعلًا) — لا قبل ذلك.
 */
export function ReferralCard() {
  useLanguage();
  const { showToast } = useToast();
  const q = useQuery({
    queryKey: ["my-referrals"],
    queryFn: async () => (await api.get<{ data: MyReferrals }>("/doctor/referrals/me")).data.data,
    retry: false,
    staleTime: 60_000,
  });
  if (q.isLoading) return null;
  if (q.isError || !q.data) {
    return <div className="card p-4 text-sm text-slate-500">{apiErrorMessage(q.error, t("تعذّر تحميل بطاقة الدعوة."))}</div>;
  }
  const link = referralLink(window.location.origin, q.data.code);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t("تم نسخ {0}.", { "0": label }), "success");
    } catch {
      showToast(t("تعذّر النسخ. انسخه يدويًا."), "error");
    }
  }
  async function share() {
    const text = t("انضم إلى MedBook لإدارة مواعيد عيادتك. سجّل عبر هذا الرابط: {0}", { "0": link });
    if (navigator.share) {
      try { await navigator.share({ title: "MedBook", text }); } catch { /* أُلغيت المشاركة */ }
    } else copy(text, t("رسالة الدعوة"));
  }

  return (
    <section className="card space-y-3 p-5" aria-labelledby="referral-title">
      <h2 id="referral-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <Gift className="h-5 w-5 text-primary-600" />{t(" دعوة زميل — مكافأة الإحالة ")}</h2>
      <p className="text-sm text-slate-600">{t("شارك رابطك مع زميل. عند توثيق حسابه تحصل على ")}{q.data.rewardDays}{t(" يومًا لاشتراكك، أو خصم تكلفة طبيب واحد للمدة نفسها إذا كنت ضمن عيادة — مرة واحدة لكل طبيب. ")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <code className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-slate-100 px-3 font-bold tracking-wider text-slate-800" dir="ltr">{q.data.code}</code>
        <button type="button" className="btn-outline min-h-[44px]" onClick={() => copy(q.data!.code, t("الكود"))}><Copy className="h-4 w-4" />{t(" نسخ الكود")}</button>
        <button type="button" className="btn-outline min-h-[44px]" onClick={() => copy(link, t("الرابط"))}><Copy className="h-4 w-4" />{t(" نسخ الرابط")}</button>
        <button type="button" className="btn-primary min-h-[44px]" onClick={share}><Share2 className="h-4 w-4" />{t(" مشاركة")}</button>
      </div>
      {q.data.referrals.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {q.data.referrals.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span className="text-slate-700">{r.referredName}</span>
              <span className={r.status === "REWARDED" ? "font-semibold text-emerald-700" : "text-slate-500"}>{r.status === "REWARDED" && r.rewardClinicId ? t("خصم لاشتراك العيادة") : t(REFERRAL_STATUS_LABELS[r.status])}</span>
            </li>
          ))}
        </ul>
      )}
      {q.data.totals.rewardedDays > 0 && <p className="text-xs text-emerald-700">{t("مجموع ما أُضيف لاشتراكك: ")}{q.data.totals.rewardedDays}{t(" يومًا.")}</p>}
      {(q.data.totals.clinicDiscountDays ?? 0) > 0 && <p className="text-xs text-emerald-700">{t("مجموع مكافآت العيادة: خصم تكلفة طبيب واحد لمدة ")}{q.data.totals.clinicDiscountDays}{t(" يومًا.")}</p>}
    </section>
  );
}

