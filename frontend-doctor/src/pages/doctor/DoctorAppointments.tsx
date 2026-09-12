import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, Bell, BellRing, CalendarDays, Clock3, MessageCircle, Phone, Search, X } from "lucide-react";
import { useMyAppointments, useUpdateAppointmentStatus } from "../../hooks/useAppointments";
import { useNewAppointmentAlert, requestNotificationPermission } from "../../hooks/useNewAppointmentAlert";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { NoShowSmsDialog, NoShowTarget } from "../../components/NoShowSmsDialog";
import { AppointmentStatus } from "../../types";

const FILTERS: { label: string; value?: AppointmentStatus }[] = [
  { label: "الكل", value: undefined },
  { label: "قادمة", value: "CONFIRMED" },
  { label: "حضروا", value: "COMPLETED" },
  { label: "لم يحضروا", value: "NO_SHOW" },
  { label: "ملغاة", value: "CANCELLED" },
];

// عتبتا التحذير من تكرار الغياب: تنبيه عادي (أصفر) ثم تحذير حاد (أحمر).
const NO_SHOW_WARNING_THRESHOLD = 2;
const NO_SHOW_CRITICAL_THRESHOLD = 5;

// كل حسابات التاريخ بتوقيت الجزائر (UTC+1)، نفس منطق الخادم.
const ALGERIA_OFFSET_MS = 60 * 60000;
const WEEKDAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** تاريخ اليوم بتوقيت الجزائر بصيغة YYYY-MM-DD. */
function algeriaTodayKey(): string {
  return new Date(Date.now() + ALGERIA_OFFSET_MS).toISOString().slice(0, 10);
}

/** يوم الموعد بصيغة YYYY-MM-DD (مخزَّن في الخادم عند 00:00 UTC). */
function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function shiftDayKey(key: string, days: number): string {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "09:20" -> "09:20 ص" / "18:16" -> "06:16 م" */
function formatTime12(startTime?: string | null): string {
  if (!startTime) return "";
  const [h, m] = startTime.split(":").map(Number);
  if (isNaN(h)) return startTime;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "ص" : "م"}`;
}

/** "اليوم، 06:16 م" / "أمس، 09:20 ص" / "الأربعاء 10/09، 09:20 ص" */
function formatWhen(dateStr: string, startTime?: string | null): string {
  const key = dayKey(dateStr);
  const time = formatTime12(startTime);
  if (!key) return time;
  const today = algeriaTodayKey();
  let day: string;
  if (key === today) day = "اليوم";
  else if (key === shiftDayKey(today, -1)) day = "أمس";
  else if (key === shiftDayKey(today, 1)) day = "غدًا";
  else {
    const d = new Date(key + "T00:00:00Z");
    day = `${WEEKDAYS_AR[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return time ? `${day}، ${time}` : day;
}

/** هل فات وقت هذا الموعد؟ نستعملها لدفع المواعيد المنتهية إلى أسفل القائمة. */
function hasTimePassed(dateStr: string, startTime: string): boolean {
  const date = new Date(dateStr);
  const [h, m] = startTime.split(":").map(Number);
  const slotUtcMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m, 0, 0) - ALGERIA_OFFSET_MS;
  return slotUtcMs < Date.now();
}

function patientFullName(a: any): string {
  if (a.patient) return `${a.patient.firstName} ${a.patient.lastName}`.trim();
  return [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ").trim() || "مريض بدون اسم";
}

function patientPhone(a: any): string | null {
  return a.patient?.user?.phone ?? a.guestPhone ?? null;
}

// 0551234567 -> 213551234567 (صيغة wa.me الدولية)
function toWhatsAppNumber(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (/^0[5-7]\d{8}$/.test(digits)) return "213" + digits.slice(1);
  if (/^213[5-7]\d{8}$/.test(digits)) return digits;
  return null;
}

/**
 * التصفية الابتدائية من رابط الصفحة (تأتي من بطاقات لوحة التحكم، مثل
 * /appointments?status=COMPLETED أو ?date=2026-09-05). "status=ALL" يعني بلا تصفية حالة،
 * وبلا أي معامل نُبقي السلوك الافتراضي: عرض المواعيد القادمة.
 */
function readInitialFilters(searchParams: URLSearchParams): { status?: AppointmentStatus; date?: string } {
  const statusParam = searchParams.get("status");
  const dateParam = searchParams.get("date") ?? undefined;
  if (statusParam === "ALL") return { status: undefined, date: dateParam };
  if (statusParam) return { status: statusParam as AppointmentStatus, date: dateParam };
  if (dateParam) return { status: undefined, date: dateParam };
  return { status: "CONFIRMED", date: undefined };
}

/** مؤشر نبض صغير يُغني عن شرح "تتحدّث الصفحة كل 15 ثانية". */
function LiveIndicator({ isFetching, updatedAt }: { isFetching: boolean; updatedAt?: number }) {
  return (
    <span className="flex items-center gap-2 text-xs text-slate-500" title="تتحدّث الصفحة تلقائيًا">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {isFetching
        ? "جارٍ التحديث..."
        : updatedAt
        ? `آخر تحديث ${formatTime12(new Date(updatedAt + ALGERIA_OFFSET_MS).toISOString().slice(11, 16))}`
        : "مباشر"}
    </span>
  );
}

/** شارة تكرار الغياب: صفراء للتنبيه، حمراء عند تجاوز العتبة الحادة. */
function NoShowWarningBadge({ count }: { count: number }) {
  if (count < NO_SHOW_WARNING_THRESHOLD) return null;
  const critical = count >= NO_SHOW_CRITICAL_THRESHOLD;
  return (
    <span
      title={`تكرر غيابه ${count} مرات سابقًا`}
      className={clsx(
        "badge shrink-0 gap-1 border",
        critical ? "border-red-200 bg-red-100 text-red-700" : "border-amber-200 bg-amber-100 text-amber-700"
      )}
    >
      <AlertTriangle className="h-3 w-3" />
      {critical ? `غياب متكرر (${count})` : `تكرر غيابه (${count})`}
    </span>
  );
}

interface CardProps {
  appointment: any;
  onComplete: () => void;
  onNoShow: () => void;
}

function AppointmentCard({ appointment: a, onComplete, onNoShow }: CardProps) {
  const phone = patientPhone(a);
  const wa = toWhatsAppNumber(phone);
  const isOpen = a.status === "CONFIRMED" || a.status === "PENDING";

  const reminderHref = wa
    ? `https://wa.me/${wa}?text=${encodeURIComponent(
        `السلام عليكم ${patientFullName(a)}، تذكير بموعدك الطبي على الساعة ${a.startTime}. نرجو الحضور في الوقت المحدد.`
      )}`
    : null;

  return (
    <article className="card flex flex-col gap-3 p-4 transition hover:border-slate-300 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      {/* البيانات — اسم المريض هو العنصر الأبرز */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-lg font-extrabold leading-tight text-slate-900">{patientFullName(a)}</h3>
          <AppointmentStatusBadge status={a.status} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
            <Clock3 className="h-4 w-4 shrink-0 text-slate-400" />
            {formatWhen(a.date, a.startTime)}
          </span>
          {phone ? (
            <a href={`tel:${phone}`} className="inline-flex min-w-0 items-center gap-1.5 text-slate-500 transition hover:text-primary-600">
              <Phone className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate" dir="ltr">
                {phone}
              </span>
            </a>
          ) : (
            <span className="text-slate-400">لا يوجد رقم هاتف</span>
          )}
        </div>

        {/* وسوم ثابتة (غير قابلة للنقر) */}
        {(!a.patient || (a.patientNoShowCount ?? 0) >= NO_SHOW_WARNING_THRESHOLD) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!a.patient && <span className="badge shrink-0 border border-slate-200 bg-slate-50 text-slate-500">بدون حساب</span>}
            <NoShowWarningBadge count={a.patientNoShowCount ?? 0} />
          </div>
        )}

        {a.notes && <p className="mt-2 line-clamp-2 break-words text-xs text-slate-400">ملاحظات: {a.notes}</p>}
      </div>

      {/* الإجراءات — مفصولة بصريًا عن الوسوم لتُقرأ كعناصر قابلة للنقر */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-3 sm:border-0 sm:pt-0">
        {isOpen && (
          <>
            {reminderHref && (
              <a
                href={reminderHref}
                target="_blank"
                rel="noopener noreferrer"
                title="تذكير المريض عبر واتساب"
                className="btn bg-[#25D366] text-white hover:brightness-95"
              >
                <MessageCircle className="h-4 w-4" /> تذكير
              </a>
            )}
            <Button onClick={onComplete}>حضر</Button>
            <Button variant="outline" onClick={onNoShow}>
              لم يحضر
            </Button>
          </>
        )}
        {a.status === "NO_SHOW" && (
          <Button variant="outline" onClick={onNoShow} title="إعادة فتح رسالة الإشعار">
            <MessageCircle className="h-4 w-4" /> إشعار SMS
          </Button>
        )}
      </div>
    </article>
  );
}

export default function DoctorAppointments() {
  const [searchParams] = useSearchParams();
  const initial = readInitialFilters(searchParams);
  const [filter, setFilter] = useState<AppointmentStatus | undefined>(initial.status);
  const [dateFilter, setDateFilter] = useState<string | undefined>(initial.date);
  const [query, setQuery] = useState("");
  const [noShowTarget, setNoShowTarget] = useState<NoShowTarget | null>(null);

  const { data: appointments, isLoading, isFetching, dataUpdatedAt } = useMyAppointments(filter, dateFilter);
  const updateStatus = useUpdateAppointmentStatus();
  const { showToast } = useToast();
  const [notifOn, setNotifOn] = useState(typeof Notification !== "undefined" && Notification.permission === "granted");

  // تنبيه فوري عند وصول حجز جديد أثناء فتح الصفحة (صوت + إشعار + رسالة).
  const handleNew = useCallback(
    (count: number) => showToast(count === 1 ? "وصلك حجز جديد!" : `وصلتك ${count} حجوزات جديدة!`, "success"),
    [showToast]
  );
  useNewAppointmentAlert(appointments, handleNew);

  // بحث محلي بالاسم أو رقم الهاتف (الأرقام تُقارن بعد تجريدها من الفواصل)، ثم ترتيب
  // يدفع المواعيد التي فات وقتها إلى أسفل القائمة.
  const visible = useMemo(() => {
    if (!appointments) return appointments;
    const q = query.trim();
    const qDigits = q.replace(/\D/g, "");
    const matches = (a: any) => {
      if (!q) return true;
      if (patientFullName(a).includes(q)) return true;
      return qDigits.length > 0 && (patientPhone(a) ?? "").replace(/\D/g, "").includes(qDigits);
    };
    return appointments
      .filter(matches)
      .sort((a: any, b: any) => Number(hasTimePassed(a.date, a.startTime)) - Number(hasTimePassed(b.date, b.startTime)));
  }, [appointments, query]);

  async function enableNotifications() {
    const res = await requestNotificationPermission();
    if (res === "granted") {
      setNotifOn(true);
      showToast("تم تفعيل إشعارات الحجوزات الجديدة.", "success");
    } else if (res === "denied") {
      showToast("الإشعارات محظورة في إعدادات المتصفح.", "error");
    } else if (res === "unsupported") {
      showToast("متصفحك لا يدعم الإشعارات.", "error");
    }
  }

  async function changeStatus(id: string, status: AppointmentStatus) {
    try {
      await updateStatus.mutateAsync({ id, status });
      showToast("تم تحديث حالة الموعد.", "success");
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  /** فتح نافذة الغياب فقط — هي التي تؤكّد ثم تُحدّث الحالة، ومن كان أصلًا NO_SHOW تُفتح له الرسالة بلا تسجيل جديد. */
  function openNoShow(a: any) {
    setNoShowTarget({
      id: a.id,
      patientName: patientFullName(a),
      phone: patientPhone(a),
      date: a.date,
      startTime: a.startTime,
      alreadyNoShow: a.status === "NO_SHOW",
    });
  }

  /** مثل changeStatus لكنه يُعيد رمي الخطأ حتى لا تفتح النافذة الرسائل عند فشل الطلب. */
  async function recordNoShow(id: string) {
    try {
      const res = await updateStatus.mutateAsync({ id, status: "NO_SHOW" });
      showToast("تم تسجيل المريض كـ «لم يحضر».", "success");
      return res;
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
      throw err;
    }
  }

  return (
    <div className="space-y-4">
      <NoShowSmsDialog target={noShowTarget} onConfirm={recordNoShow} onClose={() => setNoShowTarget(null)} />

      {/* الهيدر: العنوان + مؤشر مباشر مُختصر بدل الشرح المطوّل */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-slate-900">إدارة المواعيد</h1>
          <LiveIndicator isFetching={isFetching} updatedAt={dataUpdatedAt} />
        </div>
        <button
          type="button"
          onClick={enableNotifications}
          disabled={notifOn}
          className={clsx(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
            notifOn ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          )}
        >
          {notifOn ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          {notifOn ? "الإشعارات مفعّلة" : "تفعيل إشعارات الحجوزات"}
        </button>
      </header>

      {/* شريط الأدوات: بحث + تاريخ */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم المريض أو رقم الهاتف..."
            className="input pr-10"
            aria-label="بحث في المواعيد"
          />
        </div>
        <div className="relative shrink-0 sm:w-52">
          <CalendarDays className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="date"
            value={dateFilter ?? ""}
            onChange={(e) => setDateFilter(e.target.value || undefined)}
            className="input pr-10"
            aria-label="تصفية بالتاريخ"
          />
        </div>
      </div>

      {/* شرائح التصفية: سطر واحد قابل للتمرير الأفقي على الشاشات الصغيرة */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFilter(f.value)}
            className={clsx(
              "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition",
              filter === f.value ? "bg-primary-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {f.label}
          </button>
        ))}
        {(query || dateFilter) && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDateFilter(undefined);
            }}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-200"
          >
            <X className="h-3.5 w-3.5" /> مسح البحث والتاريخ
          </button>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : visible && visible.length > 0 ? (
        <div className="space-y-3">
          {visible.map((a: any) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              onComplete={() => changeStatus(a.id, "COMPLETED")}
              onNoShow={() => openNoShow(a)}
            />
          ))}
        </div>
      ) : (
        <EmptyState title={query ? "لا نتائج مطابقة للبحث" : "لا توجد مواعيد"} />
      )}
    </div>
  );
}
