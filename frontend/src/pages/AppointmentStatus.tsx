import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, MapPin, Phone, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { Spinner, EmptyState } from "../components/ui/States";

// نُحدّث كل 20 ثانية: سريع بما يكفي ليشعر المريض أن الرقم حيّ، وخفيف بما يكفي
// ألا يُرهق الخادم لو فتح عشرات المرضى الصفحة في نفس الوقت.
const STATUS_POLL_MS = 20000;

interface QueueStatus {
  id: string;
  date: string;
  startTime: string;
  status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "LATE" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  patientName: string;
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
  if (minutes <= 0) return "دورك التالي مباشرة";
  if (minutes < 60) return "حوالي " + minutes + " دقيقة";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return "حوالي " + hours + " ساعة" + (rest > 0 ? " و" + rest + " دقيقة" : "");
}

export default function AppointmentStatus() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["appointment-status", id],
    queryFn: async () => (await api.get<{ data: QueueStatus }>("/booking/status/" + id)).data.data,
    enabled: Boolean(id),
    refetchInterval: STATUS_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (isLoading) return <Spinner label="جارٍ تحميل حالة دورك..." />;

  if (isError || !data) {
    return (
      <div className="container-app py-10">
        <EmptyState
          title="لم نعثر على هذا الموعد"
          description="تأكد من الرابط، أو تواصل مع العيادة مباشرة."
        />
      </div>
    );
  }

  const doctorName = "د. " + data.doctor.firstName + " " + data.doctor.lastName;
  const dateLabel = new Date(data.date).toLocaleDateString("ar-DZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // الحالات المنتهية: لا رقم دور، فقط رسالة واضحة.
  const finished =
    data.status === "COMPLETED" || data.status === "CANCELLED" || data.status === "NO_SHOW";

  return (
    <div className="container-app py-8">
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-extrabold text-slate-900">متابعة دورك</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data.patientName ? data.patientName + " · " : ""}
            {doctorName}
          </p>
        </div>

        {/* البطاقة الرئيسية */}
        {finished ? (
          <div className="card p-6 text-center">
            {data.status === "COMPLETED" && (
              <>
                <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
                <p className="text-lg font-extrabold text-slate-900">انتهى موعدك</p>
                <p className="mt-1 text-sm text-slate-500">نتمنى لك الشفاء العاجل.</p>
              </>
            )}
            {data.status === "CANCELLED" && (
              <>
                <AlertTriangle className="mx-auto mb-2 h-10 w-10 text-red-500" />
                <p className="text-lg font-extrabold text-slate-900">تم إلغاء هذا الموعد</p>
              </>
            )}
            {data.status === "NO_SHOW" && (
              <>
                <AlertTriangle className="mx-auto mb-2 h-10 w-10 text-amber-500" />
                <p className="text-lg font-extrabold text-slate-900">لم يُسجَّل حضورك</p>
                <p className="mt-1 text-sm text-slate-500">يمكنك حجز موعد جديد في أي وقت.</p>
              </>
            )}
          </div>
        ) : data.status === "IN_PROGRESS" ? (
          <div className="card border-primary-300 bg-primary-50 p-6 text-center">
            <p className="text-sm font-semibold text-primary-700">دورك الآن</p>
            <p className="mt-2 text-2xl font-extrabold text-slate-900">تفضّل بالدخول</p>
          </div>
        ) : data.status === "LATE" ? (
          <div className="card border-amber-200 bg-amber-50 p-6 text-center">
            <Clock className="mx-auto mb-2 h-9 w-9 text-amber-600" />
            <p className="text-lg font-extrabold text-slate-900">نودي عليك ولم تحضر</p>
            <p className="mt-1 text-sm text-amber-700">
              {data.skipCredits > 0
                ? "يعود دورك بعد " + data.skipCredits + (data.skipCredits === 1 ? " مريض" : " مريضين")
                : "دورك التالي مباشرة — أبلغ الاستقبال أنك حاضر"}
            </p>
          </div>
        ) : data.isToday ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-slate-500">رقم دورك اليوم</p>
            <p className="my-1 text-6xl font-extrabold text-primary-700">{data.position}</p>
            <p className="text-sm font-semibold text-slate-700">
              {data.aheadOfYou === 0
                ? "أنت التالي"
                : "يسبقك " + data.aheadOfYou + (data.aheadOfYou === 1 ? " مريض" : " مرضى")}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {formatWait(data.estimatedWaitMinutes ?? 0)}
            </p>
            <p className="mt-3 text-xs text-slate-400">
              الوقت تقديري ويتغيّر حسب سير العيادة. أبقِ هذه الصفحة مفتوحة — تتحدّث تلقائيًا.
            </p>
          </div>
        ) : (
          <div className="card p-6 text-center">
            <CalendarDays className="mx-auto mb-2 h-9 w-9 text-primary-600" />
            <p className="text-lg font-extrabold text-slate-900">{dateLabel}</p>
            <p className="text-2xl font-extrabold text-primary-700">{data.startTime}</p>
            <p className="mt-2 text-xs text-slate-500">
              يظهر رقم دورك في هذه الصفحة صباح يوم الموعد.
            </p>
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
          {data.doctor.phone && (
            <a
              href={"tel:" + data.doctor.phone}
              className="flex items-center gap-2 font-semibold text-primary-600"
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
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-primary-300 disabled:opacity-60"
        >
          <RefreshCw className={"h-4 w-4 " + (isFetching ? "animate-spin" : "")} />
          {isFetching ? "جارٍ التحديث..." : "تحديث الآن"}
        </button>
      </div>
    </div>
  );
}