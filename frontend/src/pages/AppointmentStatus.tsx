import { useLanguage } from "../i18n/LanguageRoot";
import { t } from "../i18n/locale.ts";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, MapPin, Phone, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { statusPollInterval } from "../lib/statusPolling";
import { Spinner, EmptyState } from "../components/ui/States";

import { useAuth } from "../context/AuthContext";
import type { MyAppointment } from "../types";
import { arabicDate, patientName, directionsUrl } from "../lib/patientPresentation";

// نُحدّث كل 20 ثانية: سريع بما يكفي ليشعر المريض أن الرقم حيّ، وخفيف بما يكفي
// ألا يُرهق الخادم لو فتح عشرات المرضى الصفحة في نفس الوقت.
const STATUS_POLL_MS = 20000;

interface QueueStatus {
  id: string;
  date: string;
  startTime: string;
  status: "PENDING" | "CONFIRMED" | "RESCHEDULE_REQUIRED" | "IN_PROGRESS" | "LATE" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  slotMinutes: number;
  deferredCount: number;
  skipCredits: number;
  isToday: boolean;
  position: number | null;
  aheadOfYou: number | null;
  estimatedWaitMinutes: number | null;
  someoneInside: boolean;
  doctor: {
    firstName: string;
    lastName: string;
    specialty: string | null;
    address: string | null;
    phone: string | null;
  };
}

function formatWait(minutes: number): string {
  if (minutes <= 0) return t("دورك التالي مباشرة");
  if (minutes < 60) return t("حوالي ") + minutes + t(" دقيقة");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return t("حوالي ") + hours + t(" ساعة") + (rest > 0 ? t(" و") + rest + t(" دقيقة") : "");
}

export default function AppointmentStatus() {
  useLanguage();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  // Never add patient identity to the public status response. Resolve only through the authenticated account endpoint.
  const identity = useQuery({
    queryKey: ["status-beneficiary", user?.id, id],
    queryFn: async () => (await api.get<{ data: MyAppointment[] }>("/patient/account/appointments")).data.data.find(a => a.id === id),
    enabled: Boolean(user && id), retry: false, gcTime: 0,
  });

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["appointment-status", id],
    queryFn: async () => (await api.get<{ data: QueueStatus }>("/booking/status/" + id)).data.data,
    enabled: Boolean(id),
    refetchInterval: query => statusPollInterval(query.state.data, STATUS_POLL_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (isLoading) return <Spinner label={t("جارٍ تحميل حالة دورك...")} />;

  if (isError || !data) {
    return (
      <div className="container-app py-10">
        <EmptyState
          title={t("لم نعثر على هذا الموعد")}
          description={t("تأكد من الرابط، أو تواصل مع العيادة مباشرة.")}
        />
      </div>
    );
  }

  const doctorName = t("د. ") + data.doctor.firstName + " " + data.doctor.lastName;
  const dateLabel = arabicDate(data.date);
  const directions = directionsUrl(data.doctor.address);

  // الحالات المنتهية: لا رقم دور، فقط رسالة واضحة.
  const finished =
    data.status === "COMPLETED" || data.status === "CANCELLED" || data.status === "NO_SHOW" || data.status === "RESCHEDULE_REQUIRED";

  return (
    <div className="container-app py-8">
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-extrabold text-slate-900">{t("متابعة دورك")}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {doctorName}
          </p>
        </div>

        <div className="card p-4" aria-live="polite">
          {identity.data ? <>
            <p className="font-bold">{t("الموعد لـ ")}{patientName(identity.data.beneficiary)}</p>
            {identity.data.type === "FOLLOW_UP" && identity.data.createdBy === "DOCTOR" && <p className="mt-2 text-sm text-amber-800">{t("موعد عودة برمجه الطبيب")}</p>}
          </> : <p className="text-sm text-slate-600">{user ? identity.isPending ? t("جارٍ تحميل اسم المستفيد…") : t("تعذّر عرض اسم المستفيد لهذا الحساب.") : t("سجّل الدخول إلى حساب الموعد لعرض اسم المستفيد.")} <Link className="btn-outline mt-2" to={user ? "/account" : `/account/login?redirect=${encodeURIComponent(`/status/${id}`)}`}>{t("فتح حساب المريض")}</Link></p>}
        </div>
        {/* البطاقة الرئيسية */}
        {finished ? (
          <div className="card p-6 text-center">
            {data.status === "COMPLETED" && (
              <>
                <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
                <p className="text-lg font-extrabold text-slate-900">{t("انتهى موعدك")}</p>
                <p className="mt-1 text-sm text-slate-500">{t("نتمنى لك الشفاء العاجل.")}</p>
              </>
            )}
            {data.status === "CANCELLED" && (
              <>
                <AlertTriangle className="mx-auto mb-2 h-10 w-10 text-red-500" />
                <p className="text-lg font-extrabold text-slate-900">{t("تم إلغاء هذا الموعد")}</p>
              </>
            )}
            {data.status === "NO_SHOW" && (
              <>
                <AlertTriangle className="mx-auto mb-2 h-10 w-10 text-amber-500" />
                <p className="text-lg font-extrabold text-slate-900">{t("لم يُسجَّل حضورك")}</p>
                <p className="mt-1 text-sm text-slate-500">{t("يمكنك حجز موعد جديد في أي وقت.")}</p>
              </>
            )}
            {data.status === "RESCHEDULE_REQUIRED" && (
              <>
                <AlertTriangle className="mx-auto mb-2 h-10 w-10 text-red-500" />
                <p className="text-lg font-extrabold text-slate-900">{t("موعدك يحتاج إلى إعادة جدولة")}</p>
                <p className="mt-1 text-sm text-slate-600">{t("الطبيب غير متاح في هذا اليوم. ارجع إلى حسابك لحجز موعد جديد أو لإلغاء الموعد الحالي.")}</p>
              </>
            )}
          </div>
        ) : data.status === "IN_PROGRESS" ? (
          <div className="card border-primary-300 bg-primary-50 p-6 text-center">
            <p className="text-sm font-semibold text-primary-700">{t("دورك الآن")}</p>
            <p className="mt-2 text-2xl font-extrabold text-slate-900">{t("تفضّل بالدخول")}</p>
          </div>
        ) : data.status === "LATE" ? (
          <div className="card border-amber-200 bg-amber-50 p-6 text-center">
            <Clock className="mx-auto mb-2 h-9 w-9 text-amber-600" />
            <p className="text-lg font-extrabold text-slate-900">{t("نودي عليك ولم تحضر")}</p>
            <p className="mt-1 text-sm text-amber-700">
              {data.skipCredits > 0
                ? t("يعود دورك بعد ") + data.skipCredits + (data.skipCredits === 1 ? t(" مريض") : t(" مريضين"))
                : t("دورك التالي مباشرة — أبلغ الاستقبال أنك حاضر")}
            </p>
          </div>
        ) : data.isToday ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-slate-500">{t("رقم دورك اليوم")}</p>
            <p className="my-1 text-6xl font-extrabold text-primary-700">{data.position}</p>
            <p className="text-sm font-semibold text-slate-700">
              {data.aheadOfYou === 0
                ? t("أنت التالي")
                : t("يسبقك ") + data.aheadOfYou + (data.aheadOfYou === 1 ? t(" مريض") : t(" مرضى"))}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {formatWait(data.estimatedWaitMinutes ?? 0)}
            </p>
            <p className="mt-3 text-xs text-slate-400">{t("الوقت تقديري ويتغيّر حسب سير العيادة. أبقِ هذه الصفحة مفتوحة — تتحدّث تلقائيًا. ")}</p>
          </div>
        ) : (
          <div className="card p-6 text-center">
            <CalendarDays className="mx-auto mb-2 h-9 w-9 text-primary-600" />
            <p className="text-lg font-extrabold text-slate-900">{dateLabel}</p>
            <p className="text-2xl font-extrabold text-primary-700">{data.startTime}</p>
            <p className="mt-2 text-xs text-slate-500">{t("يظهر رقم دورك في هذه الصفحة صباح يوم الموعد. ")}</p>
          </div>
        )}

        {/* تفاصيل الموعد */}
        <div className="card space-y-2 p-4 text-sm">
          <p className="flex items-center gap-2 text-slate-700">
            <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
            {dateLabel} — {data.startTime}
          </p>
          {data.doctor.specialty && (
            <p className="text-slate-600">{doctorName} · {data.doctor.specialty}</p>
          )}
          {data.doctor.address && (
            <p className="flex items-center gap-2 text-slate-600">
              <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
              {data.doctor.address}
            </p>
          )}
          {directions && <a className="btn-outline min-h-[48px]" href={directions} target="_blank" rel="noopener noreferrer">{t("الاتجاهات إلى العيادة")}</a>}
          {data.doctor.phone && (
            <a
              href={"tel:" + data.doctor.phone}
              className="flex min-h-[48px] items-center gap-2 font-semibold text-primary-600"
            >
              <Phone className="h-4 w-4 shrink-0" />
              {data.doctor.phone}
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-primary-300 disabled:opacity-60"
        >
          <RefreshCw className={"h-4 w-4 " + (isFetching ? "animate-spin" : "")} />
          {isFetching ? t("جارٍ التحديث...") : t("تحديث الآن")}
        </button>
      </div>
    </div>
  );
}
