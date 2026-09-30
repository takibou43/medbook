import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, BellRing, CalendarDays, Clock, LogOut, MapPin, Plus, WifiOff } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { disablePatientPush } from "../../lib/patientPush";
import { ReminderCard } from "../../components/account/ReminderCard";
import { RateDoctorForm, RatePrompt, StarsDisplay, canRate, readDismissed, saveDismissed } from "../../components/account/RateDoctor";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import type { MyAppointment } from "../../types";
import { clearInvalidAppointmentCaches, fromCachedPatientAppointment, loadAppointmentCache, saveAppointmentCache } from "../../lib/appointmentCache";
import { useWilayas } from "../../hooks/useCatalog";
import { useMarkAllNotificationsRead, useNotifications } from "../../hooks/useNotifications";

const ACTIVE = new Set(["PENDING", "CONFIRMED", "RESCHEDULE_REQUIRED", "IN_PROGRESS", "LATE"]);
const CANCELLABLE = new Set(["PENDING", "CONFIRMED", "RESCHEDULE_REQUIRED"]);

// يوم الجزائر اليوم بصيغة YYYY-MM-DD (UTC+1 ثابت) — عمود date يحمل يوم الموعد بهذا المرجع.
function algeriaToday(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function AppointmentItem({
  a,
  highlight,
  onCancel,
  cancelling,
  onRated,
  offline,
}: {
  a: MyAppointment;
  highlight: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
  onRated?: () => void;
  offline: boolean;
}) {
  const address = a.doctor.clinic?.address || a.doctor.address;
  const [rating, setRating] = useState(false);
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
      {a.status === "RESCHEDULE_REQUIRED" && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p className="font-bold">الطبيب غير متاح في هذا اليوم.</p>
          <p className="mt-1">يرجى حجز موعد جديد أو انتظار تواصل العيادة. يمكنك إلغاء هذا الموعد دون فقدان تفاصيله.</p>
        </div>
      )}
      {a.review && !offline && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-slate-800">
            تقييمك: <StarsDisplay value={a.review.rating} />
          </p>
          {a.review.comment && <p className="mt-1 whitespace-pre-line break-words text-slate-600">{a.review.comment}</p>}
        </div>
      )}
      {onRated && !offline && canRate(a) && (
        <div className="mt-3">
          {rating ? (
            <RateDoctorForm appointment={a} onDone={() => { setRating(false); onRated(); }} onCancel={() => setRating(false)} />
          ) : (
            <button type="button" onClick={() => setRating(true)} className="min-h-[44px] text-sm font-semibold text-amber-700 hover:underline">
              ★ قيّم الطبيب
            </button>
          )}
        </div>
      )}
      {ACTIVE.has(a.status) && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {a.status !== "RESCHEDULE_REQUIRED" && (
            <Link to={`/status/${a.id}`} className="font-semibold text-primary-700 hover:underline">
              متابعة دوري
            </Link>
          )}
          {a.status === "RESCHEDULE_REQUIRED" && (
            <Link to="/" className="font-semibold text-primary-700 hover:underline">حجز موعد جديد</Link>
          )}
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
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());
  const { data: wilayas } = useWilayas();
  const { data: notifications } = useNotifications(Boolean(user));
  const markAllNotificationsRead = useMarkAllNotificationsRead();
  const [areaWilayaId, setAreaWilayaId] = useState("");
  const [areaCityId, setAreaCityId] = useState("");
  const [savingArea, setSavingArea] = useState(false);
  const initialCache = useMemo(() => {
    clearInvalidAppointmentCaches();
    return user ? loadAppointmentCache(user.id) : null;
  }, [user?.id]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [usingOfflineCopy, setUsingOfflineCopy] = useState(() => !navigator.onLine && Boolean(initialCache));

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-appointments"],
    queryFn: async () => {
      try {
        const appointments = (await api.get<{ data: MyAppointment[] }>("/patient/account/appointments")).data.data;
        if (user) saveAppointmentCache(user.id, appointments);
        setUsingOfflineCopy(false);
        return appointments;
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (!status && user) {
          setUsingOfflineCopy(true);
          const cached = loadAppointmentCache(user.id);
          if (cached) return cached.appointments.map(fromCachedPatientAppointment);
        }
        throw err;
      }
    },
    enabled: Boolean(user),
    initialData: initialCache?.appointments.map(fromCachedPatientAppointment),
    initialDataUpdatedAt: initialCache?.savedAt,
    retry: false,
    networkMode: "always",
    // الطابور يتغيّر خلال اليوم (نداء، تأخير...) — تحديث خفيف كل دقيقة ما دامت الصفحة ظاهرة.
    refetchInterval: online ? 60000 : false,
    refetchIntervalInBackground: false,
  });

  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ["patient-profile"],
    queryFn: async () => (await api.get<{ data: { cityId?: string | null; city?: { id: string; wilayaId: string; wilaya?: { id: string } } | null } }>("/patient/profile")).data.data,
    enabled: Boolean(user),
  });

  useEffect(() => {
    const city = profile?.city;
    if (!city) return;
    setAreaWilayaId(city.wilaya?.id ?? city.wilayaId);
    setAreaCityId(city.id);
  }, [profile?.city?.id, profile?.city?.wilayaId, profile?.city?.wilaya?.id]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); void refetch(); };
    const onOffline = () => { setOnline(false); if (user && loadAppointmentCache(user.id)) setUsingOfflineCopy(true); };
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [refetch, user?.id]);

  const isOffline = !online || usingOfflineCopy;
  const currentCache = user ? loadAppointmentCache(user.id) : null;

  const { upcoming, past } = useMemo(() => {
    const today = algeriaToday();
    const list = data ?? [];
    const up = list
      .filter((a) => ACTIVE.has(a.status) && a.date.slice(0, 10) >= today)
      .sort((x, y) => (x.date + x.startTime).localeCompare(y.date + y.startTime));
    const upIds = new Set(up.map((a) => a.id));
    return { upcoming: up, past: list.filter((a) => !upIds.has(a.id)) };
  }, [data]);

  // «كيف تقيّم الطبيب؟»: الموعد المفتوح من الإشعار إن كان قابلًا للتقييم، وإلا آخر موعد مكتمل فقط (إن لم
  // يُقيَّم ولم يُخفَ) — لا نلاحق المريض بمواعيد أقدم؛ تلك يبقى تقييمها متاحًا في «المواعيد السابقة».
  const ratePromptFor = useMemo(() => {
    const list = isOffline ? [] : data ?? [];
    const focused = focusId ? list.find((a) => a.id === focusId && canRate(a)) : undefined;
    if (focused) return focused;
    const latestCompleted = list.find((a) => a.status === "COMPLETED");
    return latestCompleted && canRate(latestCompleted) && !dismissed.includes(latestCompleted.id) ? latestCompleted : undefined;
  }, [data, focusId, dismissed, isOffline]);

  function dismissPrompt(id: string) {
    const next = [...dismissed.filter((x) => x !== id), id];
    setDismissed(next);
    saveDismissed(next);
  }

  async function afterRated() {
    showToast("شكرًا! تم حفظ تقييمك.", "success");
    await refetch();
  }

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
    if (isOffline) return;
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

  async function saveArea() {
    if (!areaCityId) return;
    setSavingArea(true);
    try {
      await api.patch("/patient/profile", { cityId: areaCityId });
      await refetchProfile();
      showToast("تم حفظ منطقتك. سنعلمك عند انضمام طبيب جديد في ولايتك.", "success");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر حفظ المنطقة."), "error");
    } finally {
      setSavingArea(false);
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

        {ratePromptFor && (
          <RatePrompt
            key={ratePromptFor.id}
            appointment={ratePromptFor}
            onDone={afterRated}
            onDismiss={() => {
              dismissPrompt(ratePromptFor.id);
              if (focusId === ratePromptFor.id) navigate("/account", { replace: true });
            }}
          />
        )}

        <section className="glass p-4">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><MapPin className="h-5 w-5 text-primary-600" /> منطقتي</h2>
          <p className="mt-1 text-xs text-slate-500">اختر منطقتك لتصلك إشعارات الأطباء الجدد في ولايتك.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select
              className="input"
              aria-label="الولاية"
              value={areaWilayaId}
              onChange={(event) => { setAreaWilayaId(event.target.value); setAreaCityId(""); }}
            >
              <option value="">اختر الولاية</option>
              {wilayas?.map((wilaya) => <option key={wilaya.id} value={wilaya.id}>{wilaya.nameAr}</option>)}
            </select>
            <select className="input" aria-label="البلدية" value={areaCityId} disabled={!areaWilayaId} onChange={(event) => setAreaCityId(event.target.value)}>
              <option value="">اختر البلدية</option>
              {(wilayas?.find((wilaya) => wilaya.id === areaWilayaId)?.cities ?? []).map((city) => <option key={city.id} value={city.id}>{city.nameAr}</option>)}
            </select>
          </div>
          <button type="button" className="btn-primary mt-3 min-h-[44px]" disabled={!areaCityId || savingArea} onClick={saveArea}>
            {savingArea ? "جارٍ الحفظ..." : "حفظ المنطقة"}
          </button>
        </section>

        {notifications && notifications.length > 0 && (
          <section className="glass p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-bold text-slate-900"><Bell className="h-5 w-5 text-primary-600" /> الإشعارات</h2>
              {notifications.some((notification) => !notification.isRead) && (
                <button type="button" className="text-xs font-semibold text-primary-700 hover:underline" onClick={() => markAllNotificationsRead.mutate()}>
                  تعليم الكل كمقروء
                </button>
              )}
            </div>
            <ul className="mt-3 space-y-2">
              {notifications.slice(0, 5).map((notification) => (
                <li key={notification.id} className={clsx("rounded-xl border p-3", notification.isRead ? "border-slate-200 bg-white/60" : "border-primary-200 bg-primary-50")}>
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    {!notification.isRead && <BellRing className="h-4 w-4 text-primary-600" />}{notification.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{notification.message}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ReminderCard />

        {isOffline && currentCache && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            <p className="flex items-center gap-2 font-bold"><WifiOff className="h-5 w-5" /> أنت غير متصل بالإنترنت. يتم عرض آخر نسخة محفوظة.</p>
            <p className="mt-1">آخر تحديث: {new Date(currentCache.savedAt).toLocaleString("ar-DZ")}</p>
          </div>
        )}

        <Link to="/" className="btn-primary flex min-h-[48px] w-full items-center justify-center gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" /> حجز موعد جديد
        </Link>

        {isLoading && !data ? (
          <Spinner label="جارٍ تحميل مواعيدك..." />
        ) : isOffline && !currentCache ? (
          <div className="glass p-4 text-sm text-amber-800">لا يمكن تحميل المواعيد دون اتصال. اتصل بالإنترنت مرة واحدة لعرضها لاحقًا.</div>
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
                    <AppointmentItem key={a.id} a={a} highlight={a.id === focusId} onCancel={isOffline ? undefined : () => cancel(a.id)} cancelling={cancellingId === a.id} offline={isOffline} />
                  ))}
                </ul>
              )}
            </section>
            {past.length > 0 && (
              <section>
                <h2 className="mb-2 font-bold text-slate-900">المواعيد السابقة</h2>
                <ul className="space-y-3">
                  {past.map((a) => (
                    <AppointmentItem key={a.id} a={a} highlight={a.id === focusId} onRated={isOffline ? undefined : afterRated} offline={isOffline} />
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
