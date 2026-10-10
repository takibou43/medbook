import { useLanguage } from "../../i18n/LanguageRoot";
import { t, getLocale, catalogName, getLanguage } from "../../i18n/locale.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, BellRing, CalendarDays, ClipboardList, Clock, LogOut, MapPin, Plus, RotateCcw, Users, WifiOff } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api, apiErrorMessage } from "../../lib/api";
import { disablePatientPush } from "../../lib/patientPush";
import { ReminderCard } from "../../components/account/ReminderCard";
import { ProfilesCard } from "../../components/account/ProfilesCard";
import { RateDoctorForm, RatePrompt, StarsDisplay, canRate, readDismissed, saveDismissed } from "../../components/account/RateDoctor";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import type { FamilyMember, MyAppointment } from "../../types";
import { filterByBeneficiary, memberFullName, type BeneficiaryFilter } from "../../lib/family";
import { clearInvalidAppointmentCaches, fromCachedPatientAppointment, loadAppointmentCache, saveAppointmentCache } from "../../lib/appointmentCache";
import { useWilayas } from "../../hooks/useCatalog";
import { useMarkAllNotificationsRead, useNotifications } from "../../hooks/useNotifications";

import { arabicDate, patientName, platformText } from "../../lib/patientPresentation";
import { CancelAppointmentDialog } from "../../components/account/CancelAppointmentDialog";

const ACTIVE = new Set(["PENDING", "CONFIRMED", "RESCHEDULE_REQUIRED", "IN_PROGRESS", "LATE"]);
const CANCELLABLE = new Set(["PENDING", "CONFIRMED", "RESCHEDULE_REQUIRED"]);

// يوم الجزائر اليوم بصيغة YYYY-MM-DD (UTC+1 ثابت) — عمود date يحمل يوم الموعد بهذا المرجع.
function algeriaToday(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

const formatDay = arabicDate;

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
  useLanguage();
  const address = a.doctor.clinic?.address || a.doctor.address;
  const [rating, setRating] = useState(false);
  return (
    <li id={`appointment-${a.id}`} className={clsx("glass p-4", highlight && "ring-2 ring-primary-500")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-slate-900">{t("د. ")}{a.doctor.firstName} {a.doctor.lastName}
          </p>
          {catalogName(a.doctor.specialty) && <p className="text-xs text-slate-500">{catalogName(a.doctor.specialty)}</p>}
        </div>
        <AppointmentStatusBadge status={a.status} />
      </div>
      {/* الاسم يأتي من مستفيد الموعد، دون استبداله بهوية الحساب. */}
      {a.beneficiary && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-primary-800">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />{t(" الموعد لـ ")}{patientName(a.beneficiary)}
        </p>
      )}
      {a.createdBy === "DOCTOR" && a.type === "FOLLOW_UP" && (
        <p className="mt-2 ms-1 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t(" موعد عودة برمجه الطبيب ")}</p>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-700">
        <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" /> {formatDay(a.date)}
        <Clock className="ms-2 h-4 w-4 shrink-0" aria-hidden="true" /> {a.startTime}
      </p>
      {address && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {address}
        </p>
      )}
      {a.status === "LATE" && (
        <p className="mt-2 text-sm text-orange-700">{t("تم تجاوز دورك مؤقتًا، وما زلت في قائمة الانتظار. توجّه إلى العيادة.")}</p>
      )}
      {a.status === "RESCHEDULE_REQUIRED" && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p className="font-bold">{t("الطبيب غير متاح في هذا اليوم.")}</p>
          <p className="mt-1">{t("يرجى حجز موعد جديد أو انتظار تواصل العيادة. يمكنك إلغاء هذا الموعد دون فقدان تفاصيله.")}</p>
        </div>
      )}
      {a.review && !offline && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-slate-800">{t("تقييمك: ")}<StarsDisplay value={a.review.rating} />
          </p>
          {a.review.comment && <p className="mt-1 whitespace-pre-line break-words text-slate-600">{a.review.comment}</p>}
        </div>
      )}
      {onRated && !offline && canRate(a) && (
        <div className="mt-3">
          {rating ? (
            <RateDoctorForm appointment={a} onDone={() => { setRating(false); onRated(); }} onCancel={() => setRating(false)} />
          ) : (
            <button type="button" onClick={() => setRating(true)} className="min-h-[44px] text-sm font-semibold text-amber-700 hover:underline">{t("★ قيّم الطبيب ")}</button>
          )}
        </div>
      )}
      {ACTIVE.has(a.status) && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {a.status !== "RESCHEDULE_REQUIRED" && (
            <Link to={`/status/${a.id}`} className="btn-outline min-h-[48px]">{t("متابعة دوري ")}</Link>
          )}
          {a.status === "RESCHEDULE_REQUIRED" && (
            <Link to="/" className="btn-outline min-h-[48px]">{t("حجز موعد جديد")}</Link>
          )}
          {onCancel && CANCELLABLE.has(a.status) && (
            <button type="button" onClick={onCancel} disabled={cancelling} className="ms-auto min-h-[48px] rounded-xl border border-red-200 px-4 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">{t("إلغاء الموعد ")}</button>
          )}
        </div>
      )}
    </li>
  );
}

function AccountTasks() {
  useLanguage();
  return <>
        <Link to="/" className="btn-primary flex min-h-[48px] w-full items-center justify-center gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" />{t(" حجز موعد جديد ")}</Link>

        <div className="grid grid-cols-2 gap-3">
          <Link to="/account/family" className="glass flex min-h-[48px] items-center justify-center gap-2 text-sm font-semibold text-primary-700">
            <Users className="h-4 w-4" aria-hidden="true" />{t(" أفراد العائلة ")}</Link>
          <Link to="/account/treatment-plans" className="glass flex min-h-[48px] items-center justify-center gap-2 text-sm font-semibold text-primary-700">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />{t(" خطط العلاج ")}</Link>
        </div>
  </>;
}

export default function MyAccount() {
  useLanguage();
  const { user, loading, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const focusId = params.get("appointment");
  const handledFocus = useRef<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelCandidate, setCancelCandidate] = useState<MyAppointment | null>(null);
  // فلتر المستفيد: أنا / كل الأسرة / فرد محدد (فلترة محلية على نفس القائمة).
  const [pastLimit, setPastLimit] = useState(10);
  const [beneficiary, setBeneficiary] = useState<BeneficiaryFilter>("all");
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
  }, [user?.id, getLanguage()]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [usingOfflineCopy, setUsingOfflineCopy] = useState(() => !navigator.onLine && Boolean(initialCache));

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-appointments", user?.id],
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
    queryKey: ["patient-profile", user?.id],
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
  // أفراد العائلة لخيارات الفلتر (من الخادم فقط، ولا يُخزَّنون على الجهاز).
  const { data: familyMembers } = useQuery({
    queryKey: ["family-members-all", user?.id],
    queryFn: async () => (await api.get<{ data: FamilyMember[] }>("/patient/family-members", { params: { includeArchived: "true" } })).data.data,
    enabled: Boolean(user) && online,
    retry: false,
    staleTime: 60_000,
  });
  const currentCache = user ? loadAppointmentCache(user.id) : null;

  const { upcoming, past } = useMemo(() => {
    const today = algeriaToday();
    const list = filterByBeneficiary(data ?? [], beneficiary);
    const up = list
      .filter((a) => ACTIVE.has(a.status) && a.date.slice(0, 10) >= today)
      .sort((x, y) => (x.date + x.startTime).localeCompare(y.date + y.startTime));
    const upIds = new Set(up.map((a) => a.id));
    return { upcoming: up, past: list.filter((a) => !upIds.has(a.id)) };
  }, [data, beneficiary, getLanguage()]);

  useEffect(() => {
    if (!focusId) { handledFocus.current = null; return; }
    if (handledFocus.current === focusId || !data?.some(a => a.id === focusId)) return;
    handledFocus.current = focusId;
    setBeneficiary("all");
    setPastLimit(data.length);
    const timer = window.setTimeout(() => document.getElementById(`appointment-${focusId}`)?.scrollIntoView({ block: "center" }), 0);
    return () => window.clearTimeout(timer);
  }, [focusId, data]);

  // «كيف تقيّم الطبيب؟»: الموعد المفتوح من الإشعار إن كان قابلًا للتقييم، وإلا آخر موعد مكتمل فقط (إن لم
  // يُقيَّم ولم يُخفَ) — لا نلاحق المريض بمواعيد أقدم؛ تلك يبقى تقييمها متاحًا في «المواعيد السابقة».
  const ratePromptFor = useMemo(() => {
    const list = isOffline ? [] : data ?? [];
    const focused = focusId ? list.find((a) => a.id === focusId && canRate(a)) : undefined;
    if (focused) return focused;
    const latestCompleted = list.find((a) => a.status === "COMPLETED");
    return latestCompleted && canRate(latestCompleted) && !dismissed.includes(latestCompleted.id) ? latestCompleted : undefined;
  }, [data, focusId, dismissed, isOffline, getLanguage()]);

  function dismissPrompt(id: string) {
    const next = [...dismissed.filter((x) => x !== id), id];
    setDismissed(next);
    saveDismissed(next);
  }

  async function afterRated() {
    showToast(t("شكرًا! تم حفظ تقييمك."), "success");
    await refetch();
  }

  if (loading) return <Spinner label={t("جارٍ التحميل...")} />;
  if (!user) return <Navigate to="/account/login?redirect=%2Faccount" replace />;

  async function handleLogout() {
    // نفصل هذا الجهاز عن الحساب قبل الخروج حتى لا تصل تذكيرات الحساب إلى جهاز لم يعد صاحبه يستعمله.
    await disablePatientPush().catch(() => undefined);
    await logout();
    queryClient.removeQueries({ queryKey: ["my-appointments"] });
    showToast(t("تم تسجيل الخروج."), "success");
    navigate("/", { replace: true });
  }

  async function cancel(id: string) {
    if (isOffline) return;
    const appointment = data?.find(a => a.id === id);
    if (!appointment) return;
    if (!CANCELLABLE.has(appointment.status) || cancellingId) return;
    setCancellingId(id);
    try {
      await api.delete(`/appointments/${id}`);
      setCancelCandidate(null);
      showToast(t("تم إلغاء الموعد."), "success");
      await refetch();
    } catch (err) {
      showToast(apiErrorMessage(err, t("تعذّر إلغاء الموعد.")), "error");
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
      showToast(t("تم حفظ منطقتك. سنعلمك عند انضمام طبيب جديد في ولايتك."), "success");
    } catch (err) {
      showToast(apiErrorMessage(err, t("تعذّر حفظ المنطقة.")), "error");
    } finally {
      setSavingArea(false);
    }
  }

  const fullName = [user.patient?.firstName, user.patient?.lastName].filter(Boolean).join(" ");

  return (
    <div className="container-app py-8">
      <div className="patient-account mx-auto max-w-xl space-y-5">
        <div className="glass flex items-start justify-between gap-3 p-5">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-slate-900">{fullName || t("حسابي")}</h1>
            <p className="truncate text-sm text-slate-600" dir="ltr">
              {user.email}
            </p>
          </div>
          <button type="button" onClick={handleLogout} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-red-600">
            <LogOut className="h-4 w-4" aria-hidden="true" />{t(" تسجيل الخروج ")}</button>
        </div>

        {isOffline && currentCache && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            <p className="flex items-center gap-2 font-bold"><WifiOff className="h-5 w-5" />{t(" أنت غير متصل بالإنترنت. يتم عرض آخر نسخة محفوظة.")}</p>
            <p className="mt-1">{t("آخر تحديث: ")}{new Date(currentCache.savedAt).toLocaleString(getLocale())}</p>
          </div>
        )}

        {!isOffline && (familyMembers?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("عرض مواعيد")}>
            {[
              { id: "all", label: t("كل الأسرة") },
              { id: "self", label: t("أنا") },
              ...(familyMembers ?? []).map((m) => ({ id: m.id, label: memberFullName(m) + (m.archivedAt ? t(" (مؤرشف)") : "") })),
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={beneficiary === f.id}
                onClick={() => { setBeneficiary(f.id); setPastLimit(10); }}
                className={clsx(
                  "min-h-[48px] rounded-full border px-3 text-sm font-semibold transition",
                  beneficiary === f.id ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-primary-400"
                )}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
        )}

        {(isLoading && !data || isError || isOffline && !currentCache) && <>
            <AccountTasks />

        </>}
        {isLoading && !data ? (
          <Spinner label={t("جارٍ تحميل مواعيدك...")} />
        ) : isOffline && !currentCache ? (
          <div className="glass p-4 text-sm text-amber-800">{t("لا يمكن تحميل المواعيد دون اتصال. اتصل بالإنترنت مرة واحدة لعرضها لاحقًا.")}</div>
        ) : isError ? (
          <div className="glass p-4 text-sm text-red-600">
            {apiErrorMessage(error, t("تعذّر تحميل مواعيدك."))}{" "}
            <button type="button" className="font-semibold underline" onClick={() => refetch()}>{t("إعادة المحاولة ")}</button>
          </div>
        ) : (
          <>
            <section>
              <h2 className="mb-2 font-bold text-slate-900">{t("مواعيدي القادمة")}</h2>
              {upcoming.length === 0 ? (
                <p className="glass p-4 text-sm text-slate-500">{t("لا توجد مواعيد قادمة.")}</p>
              ) : (
                <ul className="space-y-3">
                  {upcoming.map((a) => (
                    <AppointmentItem key={a.id} a={a} highlight={a.id === focusId} onCancel={isOffline ? undefined : () => setCancelCandidate(a)} cancelling={cancellingId === a.id} offline={isOffline} />
                  ))}
                </ul>
              )}
            </section>
            <AccountTasks />

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

            {past.length > 0 && (
              <section>
                <h2 className="mb-2 font-bold text-slate-900">{t("المواعيد السابقة")}</h2>
                <ul className="space-y-3">
                  {past.slice(0, pastLimit).map((a) => (
                    <AppointmentItem key={a.id} a={a} highlight={a.id === focusId} onRated={isOffline ? undefined : afterRated} offline={isOffline} />
                  ))}
                </ul>
                {past.length > pastLimit && <button type="button" className="btn-outline mt-3 w-full min-h-[48px]" onClick={() => setPastLimit(n => n + 10)}>{t("عرض المزيد (")}{past.length - pastLimit}{t(" موعدًا)")}</button>}
              </section>
            )}
          </>
        )}
        {notifications && notifications.length > 0 && (
          <section className="glass p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-bold text-slate-900"><Bell className="h-5 w-5 text-primary-600" />{t(" الإشعارات")}</h2>
              {notifications.some((notification) => !notification.isRead) && (
                <button type="button" className="min-h-[48px] rounded-xl px-3 text-xs font-semibold text-primary-700 hover:bg-primary-50" disabled={markAllNotificationsRead.isPending} onClick={() => markAllNotificationsRead.mutate(undefined, { onError: err => showToast(apiErrorMessage(err, t("تعذّر تعليم الإشعارات كمقروء.")), "error") })}>{t("تعليم الكل كمقروء ")}</button>
              )}
            </div>
            <ul className="mt-3 space-y-2">
              {notifications.slice(0, 5).map((notification) => (
                <li key={notification.id} className={clsx("rounded-xl border p-3", notification.isRead ? "border-slate-200 bg-white/60" : "border-primary-200 bg-primary-50")}>
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    {!notification.isRead && <BellRing className="h-4 w-4 text-primary-600" />}{platformText(notification.title)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{platformText(notification.message)}</p>
                  <p className="mt-1 text-xs text-slate-500">{arabicDate(notification.createdAt)}</p>
                  {notification.appointmentId && data?.some(a => a.id === notification.appointmentId) && <Link className="btn-outline mt-2 min-h-[48px]" to={`/account?appointment=${encodeURIComponent(notification.appointmentId)}`}>{t("عرض الموعد")}</Link>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <details className="glass p-4">
          <summary className="min-h-[48px] cursor-pointer font-bold">{t("الإعدادات: المنطقة وتفضيلات الإشعارات")}</summary>
          <div className="mt-3 space-y-4">
        <section className="glass p-4">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><MapPin className="h-5 w-5 text-primary-600" />{t(" منطقتي")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("اختر منطقتك لتصلك إشعارات الأطباء الجدد في ولايتك.")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select
              className="input"
              aria-label={t("الولاية")}
              value={areaWilayaId}
              onChange={(event) => { setAreaWilayaId(event.target.value); setAreaCityId(""); }}
            >
              <option value="">{t("اختر الولاية")}</option>
              {wilayas?.map((wilaya) => <option key={wilaya.id} value={wilaya.id}>{catalogName(wilaya)}</option>)}
            </select>
            <select className="input" aria-label={t("البلدية")} value={areaCityId} disabled={!areaWilayaId} onChange={(event) => setAreaCityId(event.target.value)}>
              <option value="">{t("اختر البلدية")}</option>
              {(wilayas?.find((wilaya) => wilaya.id === areaWilayaId)?.cities ?? []).map((city) => <option key={city.id} value={city.id}>{city.nameAr}</option>)}
            </select>
          </div>
          <button type="button" className="btn-primary mt-3 min-h-[44px]" disabled={!areaCityId || savingArea} onClick={saveArea}>
            {savingArea ? t("جارٍ الحفظ...") : t("حفظ المنطقة")}
          </button>
        </section>

        <ReminderCard />

          </div>
        </details>
        <ProfilesCard />
        {cancelCandidate && <CancelAppointmentDialog appointment={cancelCandidate} busy={Boolean(cancellingId)} onClose={() => setCancelCandidate(null)} onConfirm={() => void cancel(cancelCandidate.id)} />}
      </div>
    </div>
  );
}
