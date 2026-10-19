import { ArrivalPoster } from "../../components/ArrivalPoster";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLocale } from "../../i18n/locale.ts";
import { Link } from "react-router-dom";
import { useQueue } from "../../hooks/useQueue";
import { algeriaToday, appointmentsLink, appointmentsCountAr, formatDayAr, formatDzd as fmtDzd, formatPercent } from "../../lib/doctorUi";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarClock, CalendarDays, Users, CheckCircle2, XCircle, Star, AlertTriangle, Wallet } from "lucide-react";
import { api } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/ui/States";
import { VerificationBadge } from "../../components/ui/Badge";
import { useAuth } from "../../context/AuthContext";

import { ReferralCard } from "../../components/ReferralCard";
import { useLiveUpdates } from "../../context/LiveUpdatesContext";
import { livePollInterval } from "../../lib/livePolling";

// تاريخ اليوم بتوقيت الجزائر (UTC+1) بصيغة YYYY-MM-DD — يُستخدم لبناء رابط بطاقة
// "مواعيد اليوم" في صفحة المواعيد (نفس منطق الإزاحة الزمنية المستخدم في بقية الموقع).
function algeriaTodayIso(): string {
  const algeriaNow = new Date(Date.now() + 60 * 60000);
  return algeriaNow.toISOString().slice(0, 10);
}

/** نفس تنسيق العملة المستعمل في بقية اللوحة. */
function formatDzd(value: number): string {
  return fmtDzd(value);
}

/**
 * الدخل التقديري: للطبيب بطاقة بقيمتين (اليوم وهذا الشهر)، وللمساعد بطاقة اليوم فقط —
 * `month`/`fee` ببساطة لا تصلان في استجابة /doctor/dashboard الخاصة بالمساعد أصلًا
 * (الخادم لا يرسلهما، لا الواجهة فقط تُخفيهما)، فحين تكونان undefined نعرض عمودًا واحدًا.
 * القيم تأتي من الخادم محسوبة من المواعيد المكتملة (COMPLETED) وحدها × سعر استشارة الطبيب.
 */
function RevenueCard({ today, month, fee }: { today: number; month?: number; fee?: number }) {
  useLanguage();
  const showMonth = month !== undefined;
  return (
    <section className="card p-4 sm:p-5" aria-label={t("الدخل التقديري")}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700">
          <Wallet className="h-[18px] w-[18px]" />
        </span>
        <h2 className="text-base font-bold text-slate-800">{t("الدخل التقديري")}</h2>
      </div>

      <div className={clsx("mt-3 grid gap-2.5 sm:gap-4", showMonth ? "grid-cols-2" : "grid-cols-1")}>
        <div className="min-w-0 rounded-xl bg-green-50 p-3">
          <p className="text-xs font-semibold text-green-800">{t("اليوم")}</p>
          <p className="mt-0.5 truncate text-lg font-extrabold tabular-nums text-slate-900 sm:text-2xl">{formatDzd(today)}</p>
        </div>
        {showMonth && (
          <div className="min-w-0 rounded-xl bg-green-50 p-3">
            <p className="text-xs font-semibold text-green-800">{t("هذا الشهر")}</p>
            <p className="mt-0.5 truncate text-lg font-extrabold tabular-nums text-slate-900 sm:text-2xl">{formatDzd(month)}</p>
          </div>
        )}
      </div>

      <p className="mt-2.5 text-[11px] leading-4 text-slate-500">{t("يُحسب من المواعيد المكتملة بسعر كل موعد وقت حجزه.")}</p>
      {fee === 0 && <p className="mt-1 text-[11px] leading-4 text-amber-700">{t("أضف سعر الاستشارة في إعدادات ملفك لحساب الدخل.")}</p>}
    </section>
  );
}

function patientName(a: import("../../types").Appointment): string {
  if (a.familyMember) return a.familyMember.firstName + " " + a.familyMember.lastName;
  if (a.patient) return a.patient.firstName + " " + a.patient.lastName;
  return [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ") || t("مريض");
}
export default function DoctorOverview() {
  useLanguage();
  const { user } = useAuth();
  const queue = useQueue();
  const live = useLiveUpdates();
  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["doctor-dashboard"],
    queryFn: async () => (await api.get("/doctor/dashboard")).data.data,
    // تحديث تلقائي للأرقام دون إعادة تحميل الصفحة (يتوقف عندما يكون التبويب في الخلفية).
    refetchInterval: livePollInterval(live, 30000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <Spinner />;
  if (isError) return <div role="alert">{t("تعذر تحميل ملخص اليوم. ")}<button onClick={() => void refetch()}>{t("إعادة المحاولة")}</button></div>;

  const isAssistant = user?.role === "ASSISTANT";
  const effectiveDoctor = user?.doctor ?? user?.assistant?.doctor;

  // عدّ الأيام المتبقية من الاشتراك (أو التجربة المجانية). نعرض التنبيه طوال المدة لا في
  // آخر أيامها فقط، حتى يعرف الطبيب منذ اليوم الأول أن المدة محدودة ولا يُفاجأ بتوقف ظهوره.
  const clinicSubscription = user?.doctor?.clinic?.ownerId ? user.doctor.clinic : null;
  const effectiveExpiry = clinicSubscription ? clinicSubscription.subscriptionExpiresAt : user?.doctor?.subscriptionExpiresAt;
  const subscriptionEndsAt = effectiveExpiry ? new Date(effectiveExpiry) : null;
  const validEnd = subscriptionEndsAt && !isNaN(subscriptionEndsAt.getTime()) ? subscriptionEndsAt : null;
  const daysLeft = validEnd ? Math.max(0, Math.ceil((validEnd.getTime() - Date.now()) / 86400000)) : null;

  return (
    <div className="space-y-6">
      {!isAssistant && clinicSubscription && <p className="rounded-xl bg-primary-50 p-4 text-primary-800">{t("اشتراكك مشمول في اشتراك ")}{clinicSubscription.nameAr}{t(". يدير صاحب العيادة التجديد والدفع.")}</p>}
      {!clinicSubscription && daysLeft !== null && validEnd && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">
            {daysLeft > 0
              ? t("اشتراكك المجاني ينتهي يوم ") + validEnd.toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) + t(" — متبقٍ ") + daysLeft + (daysLeft === 1 ? t(" يوم") : t(" يومًا")) + t(". بعده يتوقف ظهورك للمرضى حتى التجديد.")
              : t("انتهت مدة اشتراكك المجاني. تواصل مع إدارة المنصة لتجديد الاشتراك والعودة إلى الظهور للمرضى.")}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">{isAssistant ? (effectiveDoctor ? t("د. {0} {1}", { "0": effectiveDoctor.firstName, "1": effectiveDoctor.lastName }) : t("اليوم")) : t("نظرة عامة")}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{formatDayAr(algeriaToday(), { weekday: true, year: true })}</p>
        </div>
        {stats && <VerificationBadge status={stats.verificationStatus} />}
      </div>

      {stats?.verificationStatus === "PENDING" && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {isAssistant
            ? t("ملف الطبيب قيد المراجعة من طرف الإدارة. لن يظهر في نتائج بحث المرضى حتى تتم الموافقة.")
            : t("ملفك المهني قيد المراجعة من طرف الإدارة. لن تظهر في نتائج بحث المرضى حتى تتم الموافقة.")}
        </div>
      )}

      {/* month/fee بلا "?? 0": يجب أن تبقيا undefined فعليًا حين لا يُرسلهما الخادم (حالة
          المساعد) حتى يُخفي RevenueCard عمود "هذا الشهر" تلقائيًا بدل عرض 0 مضلِّل. */}
      {isAssistant && (
      <section className="card space-y-4 p-5" aria-label={t("ملخص اليوم")}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{t("اليوم في العيادة")}</h2></div>
        {queue.isPending ? <Spinner /> : queue.isError ? <p role="alert">{t("تعذر تحميل الطابور. ")}<button onClick={() => void queue.refetch()}>{t("إعادة المحاولة")}</button></p> : <>
          <div className="grid grid-cols-3 gap-2"><div className="rounded-xl bg-primary-50 p-3"><p className="text-xs">{t("المنتظرون")}</p><p className="text-2xl font-bold">{queue.data?.waiting.length ?? 0}</p></div><div className="rounded-xl bg-amber-50 p-3"><p className="text-xs">{t("المتأخرون")}</p><p className="text-2xl font-bold">{queue.data?.late.length ?? 0}</p></div><div className="rounded-xl bg-green-50 p-3"><p className="text-xs">{t("مكتملة اليوم")}</p><p className="text-2xl font-bold">{queue.data?.todaySummary?.completed ?? stats?.completedToday ?? 0}</p></div></div>
          <p className="rounded-xl bg-slate-50 p-3">{t("المريض الحالي: ")}{queue.data?.current ? patientName(queue.data.current) : t("لا يوجد مريض بالداخل الآن")}</p>
          <h3 className="font-semibold">{t("المواعيد التالية في الطابور")}</h3>
          {(queue.data?.ordered ?? [...(queue.data?.waiting ?? []), ...(queue.data?.late ?? [])]).slice(0, 3).map(a => <div key={a.id} className="flex justify-between gap-3 border-t pt-2"><span>{patientName(a)}</span><span className="ltr-nums">{a.startTime}</span></div>)}
          {!queue.data?.waiting.length && !queue.data?.late.length && <p className="text-sm text-slate-500">{t("لا يوجد منتظرون الآن.")}</p>}
          <Link to="/appointments?tab=queue" className="block rounded-xl bg-primary-600 px-4 py-3 text-center text-base font-bold text-white transition hover:bg-primary-700">{t("فتح الطابور")}</Link>
        </>}
      </section>
      )}
      {stats?.rescheduleRequired > 0 && <Link className="block rounded-xl bg-amber-50 p-4 text-amber-800" to={appointmentsLink({status: "RESCHEDULE_REQUIRED"})}>{appointmentsCountAr(stats.rescheduleRequired)}{t(" بحاجة إلى إعادة جدولة — مراجعة المواعيد")}</Link>}

      <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
        <StatCard label={t("مواعيد اليوم")} value={stats?.todayAppointments ?? 0} icon={CalendarClock} to={appointmentsLink({from: algeriaTodayIso(), to: algeriaTodayIso()})} />
        {isAssistant ? (
          <StatCard
            label={t("أُنجزت اليوم")}
            value={stats?.completedToday ?? 0}
            icon={CheckCircle2}
            tone="green"
            to={`/appointments?status=COMPLETED&date=${algeriaTodayIso()}`}
          />
        ) : (
          <StatCard
            label={t("متوسط التقييم")}
            value={`${(stats?.avgRating ?? 0).toFixed(1)} / 5`}
            sub={(stats?.reviewsCount ?? 0) > 0 ? t("من {0} تقييم", { "0": stats?.reviewsCount }) : t("لا توجد تقييمات بعد")}
            icon={Star}
            tone="amber"
            to="/reviews"
          />
        )}
      </div>

      {/* إحصاءات إضافية: للطبيب فقط (لا يرسلها الخادم للمساعد أصلًا)، مطويّة افتراضيًا. */}
      {!isAssistant && (
        <details open className="card p-4 sm:p-5">
          <summary className="cursor-pointer font-bold text-slate-800">{t("المزيد من الإحصاءات")}</summary>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
            <StatCard label={t("إجمالي المرضى")} value={stats?.totalPatients ?? 0} sub={t("يشمل أفراد العائلة وسجلات الضيوف وفق قائمة المرضى")} icon={Users} to="/patients" />
            <StatCard label={t("مواعيد هذا الشهر")} value={stats?.monthlyAppointments ?? 0} icon={CalendarDays} to={appointmentsLink(stats?.monthRange)} />
            <StatCard label={t("المواعيد المكتملة")} value={stats?.completedAppointments ?? 0} icon={CheckCircle2} tone="green" to="/appointments?status=COMPLETED" />
            <StatCard label={t("المواعيد الملغاة")} value={stats?.cancelledAppointments ?? 0} icon={XCircle} tone="red" to="/appointments?status=CANCELLED" />
            <StatCard
              label={t("نسبة الغياب")}
              value={`${stats?.noShowRate ?? 0}%`}
              sub={t("من المواعيد المنتهية")}
              icon={AlertTriangle}
              tone={((stats?.noShowRate ?? 0) > 20) ? "red" : "amber"}
              to="/appointments?status=NO_SHOW"
            />
          </div>
        </details>
      )}

      <details open={!isAssistant} className="space-y-4">
        <summary className="card flex cursor-pointer items-center justify-between gap-3 p-4 font-bold text-slate-800">
          <span>{t("الدخل والمستحقات")}</span>
          <span className="text-sm font-semibold text-green-700">{t("اليوم: ")}{formatDzd(stats?.estimatedRevenueToday ?? 0)}</span>
        </summary>
      <RevenueCard today={stats?.estimatedRevenueToday ?? 0} month={stats?.estimatedRevenueMonth} fee={stats?.consultationFee} />
      {/* مستحقاتي في العيادة: يرسلها الخادم للطبيب وحده ولنفسه فقط (غائبة عن المساعد والطبيب المستقل). */}
      {stats?.clinicEarnings && !isAssistant && (
        <section className="card p-4 sm:p-5" aria-label={t("مستحقاتي في العيادة")}>
          <h2 className="text-base font-bold text-slate-800">{t("مستحقاتي في العيادة")}</h2>
          {stats.clinicEarnings.doctorSharePercent == null ? (
            <p className="mt-2 text-sm text-amber-700">{t("لم يحدد مدير العيادة نسبتك بعد، لذلك لا تُحسب مستحقاتك حاليًا.")}</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-600">{t("نسبتك ")}{formatPercent(stats.clinicEarnings.doctorSharePercent)}{t(" · نسبة العيادة ")}{formatPercent(stats.clinicEarnings.clinicSharePercent)}{t(" · سعر الموعد ")}{fmtDzd(stats.clinicEarnings.appointmentPriceDzd)}</p>
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                <div className="rounded-xl bg-green-50 p-3"><p className="text-xs font-semibold text-green-800">{t("اليوم")}</p><p className="mt-0.5 truncate text-base font-extrabold tabular-nums sm:text-xl">{fmtDzd(stats.clinicEarnings.duesToday)}</p></div>
                <div className="rounded-xl bg-green-50 p-3"><p className="text-xs font-semibold text-green-800">{t("هذا الشهر")}</p><p className="mt-0.5 truncate text-base font-extrabold tabular-nums sm:text-xl">{fmtDzd(stats.clinicEarnings.duesMonth)}</p></div>
                <div className="rounded-xl bg-green-50 p-3"><p className="text-xs font-semibold text-green-800">{t("الإجمالي")}</p><p className="mt-0.5 truncate text-base font-extrabold tabular-nums sm:text-xl">{fmtDzd(stats.clinicEarnings.duesTotal)}</p></div>
              </div>
            </>
          )}
          {stats.clinicEarnings.completedWithoutShareTotal > 0 && <p role="status" className="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs font-semibold text-amber-900">{stats.clinicEarnings.completedWithoutShareTotal}{t(" موعدًا مكتملًا لم تُحسب مستحقاته لعدم تحديد النسبة وقت حجزه.")}</p>}
          <p className="mt-2.5 text-[11px] leading-4 text-slate-500">{t("مبالغ تقديرية للمواعيد المكتملة فقط، بالسعر والنسبة وقت الحجز. ليست إثباتًا للدفع أو التحصيل، ولا دفع عبر النظام.")}</p>
        </section>
      )}
      </details>
      <details open={!isAssistant} className="space-y-4"><summary className="cursor-pointer font-bold">{t("رمز الحجز ودعوة زميل")}</summary>
      <ArrivalPoster />

      {/* «ادعُ طبيبًا» — للطبيب وحده (المساعد لا يرى الإحالات ولا الاشتراك). */}
      {!isAssistant && <ReferralCard />}
      </details>
    </div>
  );
}
