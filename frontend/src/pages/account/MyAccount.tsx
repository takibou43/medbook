import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarDays, Clock, LogOut, MapPin, Plus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { disablePatientPush } from "../../lib/patientPush";
import { ReminderCard } from "../../components/account/ReminderCard";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import type { MyAppointment } from "../../types";

const ACTIVE = new Set(["PENDING", "CONFIRMED", "IN_PROGRESS", "LATE"]);
const CANCELLABLE = new Set(["PENDING", "CONFIRMED"]);

// يوم الجزائر اليوم بصيغة YYYY-MM-DD (UTC+1 ثابت) — عمود date يحمل يوم الموعد بهذا المرجع.
function algeriaToday(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function AppointmentItem({ a, highlight, onCancel, cancelling }: { a: MyAppointment; highlight: boolean; onCancel?: () => void; cancelling?: boolean }) {
  const address = a.doctor.clinic?.address || a.doctor.address;
  return (
    <li className={clsx("glass p-4", highlight && "ring-2 ring-primary-500")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-slate-900">
            د. {a.doctor.firstName} {a.doctor.lastName}
          </p>
          {a.doctor.specialty?.nameAr && <p className="text-xs text-slate-500">{a.doctor.specialty.nameAr}</p>}
        </div>
        <AppointmentStatusBadge status={a.status} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-700">
        <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" /> {formatDay(a.date)}
        <Clock className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" /> {a.startTime}
      </p>
      {address && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {address}
        </p>
      )}
      {a.status === "LATE" && (
        <p className="mt-2 text-sm text-orange-700">تم تجاوز دورك مؤقتًا، وما زلت في قائمة الانتظار. توجّه إلى العيادة.</p>
      )}
      {ACTIVE.has(a.status) && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link to={`/status/${a.id}`} className="font-semibold text-primary-700 hover:underline">
            متابعة دوري
          </Link>
          {onCancel && CANCELLABLE.has(a.status) && (
            <button type="button" onClick={onCancel} disabled={cancelling} className="font-semibold text-red-600 hover:underline disabled:opacity-50">
              إلغاء الموعد
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function MyAccount() {
  const { user, loading, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const focusId = params.get("appointment");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-appointments"],
    queryFn: async () => (await api.get<{ data: MyAppointment[] }>("/patient/account/appointments")).data.data,
    enabled: Boolean(user),
    // الطابور يتغيّر خلال اليوم (نداء، تأخير...) — تحديث خفيف كل دقيقة ما دامت الصفحة ظاهرة.
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  const { upcoming, past } = useMemo(() => {
    const today = algeriaToday();
    const list = data ?? [];
    const up = list
      .filter((a) => ACTIVE.has(a.status) && a.date.slice(0, 10) >= today)
      .sort((x, y) => (x.date + x.startTime).localeCompare(y.date + y.startTime));
    const upIds = new Set(up.map((a) => a.id));
    return { upcoming: up, past: list.filter((a) => !upIds.has(a.id)) };
  }, [data]);

  if (loading) return <Spinner label="جارٍ التحميل..." />;
  if (!user) return <Navigate to="/account/login?redirect=%2Faccount" replace />;

  async function handleLogout() {
    // نفصل هذا الجهاز عن الحساب قبل الخروج حتى لا تصل تذكيرات الحساب إلى جهاز لم يعد صاحبه يستعمله.
    await disablePatientPush().catch(() => undefined);
    await logout();
    queryClient.removeQueries({ queryKey: ["my-appointments"] });
    showToast("تم تسجيل الخروج.", "success");
    navigate("/", { replace: true });
  }

  async function cancel(id: string) {
    if (!window.confirm("هل تريد إلغاء هذا الموعد؟")) return;
    setCancellingId(id);
    try {
      await api.delete(`/appointments/${id}`);
      showToast("تم إلغاء الموعد.", "success");
      await refetch();
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إلغاء الموعد."), "error");
    } finally {
      setCancellingId(null);
    }
  }

  const fullName = [user.patient?.firstName, user.patient?.lastName].filter(Boolean).join(" ");

  return (
    <div className="container-app py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="glass flex items-start justify-between gap-3 p-5">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-slate-900">{fullName || "حسابي"}</h1>
            <p className="truncate text-sm text-slate-600" dir="ltr">
              {user.email}
            </p>
          </div>
          <button type="button" onClick={handleLogout} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-red-600">
            <LogOut className="h-4 w-4" aria-hidden="true" /> تسجيل الخروج
          </button>
        </div>

        <ReminderCard />

        <Link to="/" className="btn-primary flex min-h-[48px] w-full items-center justify-center gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" /> حجز موعد جديد
        </Link>

        {isLoading ? (
          <Spinner label="جارٍ تحميل مواعيدك..." />
        ) : isError ? (
          <div className="glass p-4 text-sm text-red-600">
            {apiErrorMessage(error, "تعذّر تحميل مواعيدك.")}{" "}
            <button type="button" className="font-semibold underline" onClick={() => refetch()}>
              إعادة المحاولة
            </button>
          </div>
        ) : (
          <>
            <section>
              <h2 className="mb-2 font-bold text-slate-900">مواعيدي القادمة</h2>
              {upcoming.length === 0 ? (
                <p className="glass p-4 text-sm text-slate-500">لا توجد مواعيد قادمة.</p>
              ) : (
                <ul className="space-y-3">
                  {upcoming.map((a) => (
                    <AppointmentItem key={a.id} a={a} highlight={a.id === focusId} onCancel={() => cancel(a.id)} cancelling={cancellingId === a.id} />
                  ))}
                </ul>
              )}
            </section>
            {past.length > 0 && (
              <section>
                <h2 className="mb-2 font-bold text-slate-900">المواعيد السابقة</h2>
                <ul className="space-y-3">
                  {past.map((a) => (
                    <AppointmentItem key={a.id} a={a} highlight={a.id === focusId} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
