import { canSendAttendanceMessage } from "../../lib/assistantReception";
import { useAttendanceActions } from "../../hooks/useAttendanceActions";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, CalendarPlus, CheckCircle2, Clock3, Info, MessageCircle, Phone, Search, UserCheck, X } from "lucide-react";
import { useMyAppointments, useUpdateAppointmentStatus } from "../../hooks/useAppointments";
import { AppointmentStatusBadge } from "../../components/ui/Badge";
import { EmptyState, ErrorState, SkeletonRows } from "../../components/ui/States";
import { DateField } from "../../components/ui/DateField";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import { NoShowSmsDialog, NoShowTarget } from "../../components/NoShowSmsDialog";
import { AppointmentStatus } from "../../types";
import DoctorQueue from "./DoctorQueue";
import { useAuth } from "../../context/AuthContext";
import { FollowUpModal, type FollowUpContext } from "../../components/FollowUpModal";
import { canScheduleFollowUp, RELATIONSHIP_LABELS } from "../../lib/features";
import {
  activePreset, appointmentActions, formatDayAr, parseAppointmentFilters, presetRange, serializeAppointmentFilters,
  type AppointmentFilters, type DatePreset, type StatusFilter,
} from "../../lib/doctorUi";

// «مكتملة» (COMPLETED) بدل «حضروا»: الحالة تعني أن الاستشارة اكتملت، لا مجرد الوصول.
const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "الكل", value: "ALL" },
  { label: "مؤكدة", value: "CONFIRMED" },
  { label: "تحتاج إعادة جدولة", value: "RESCHEDULE_REQUIRED" },
  { label: "مكتملة", value: "COMPLETED" },
  { label: "لم يحضروا", value: "NO_SHOW" },
  { label: "ملغاة", value: "CANCELLED" },
];

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "week", label: "هذا الأسبوع" },
  { key: "month", label: "هذا الشهر" },
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
  // موعد لفرد من عائلة صاحب الحساب: اسم المستفيد (لا اسم صاحب الحساب).
  if (a.beneficiary?.type === "FAMILY_MEMBER") return a.beneficiary.name;
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
  /** «اكتمل الموعد» (COMPLETED) — تظهر فقط حين تسمح بها الحالة والتوقيت والدور (appointmentActions). */
  onComplete: () => void;
  onNoShow: () => void;
  /** وصل المريض بعد تسجيل غيابه: يُدخله الآن (IN_PROGRESS) دون أي رسالة. */
  onArrivedLate: () => void;
  /** طلب تحديث جارٍ — نُعطّل الإجراءات لمنع النقر المتكرر وطلبات PATCH زائدة. */
  busy?: boolean;
  /** هذا الموعد تحديدًا هو قيد التحديث — يظهر مؤشر التحميل على أزراره. */
  pending?: boolean;
  /** «برمجة موعد عودة» (الطبيب وحده، لمريض بحساب). */
  onFollowUp?: () => void;
  role?: "DOCTOR" | "ASSISTANT";
  canManageAttendance: boolean;
}

function AppointmentCard({ appointment: a, onComplete, onNoShow, onArrivedLate, busy, pending, onFollowUp, role, canManageAttendance }: CardProps) {
  const phone = patientPhone(a);
  const wa = toWhatsAppNumber(phone);
  const isOpen = a.status === "CONFIRMED" || a.status === "PENDING";
  const actions = appointmentActions(a, role);

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
            <a href={`tel:${phone}`} className="inline-flex min-w-0 items-center gap-1.5 text-slate-600 transition hover:text-primary-700" aria-label={`اتصال بالرقم ${phone}`}>
              <Phone className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="ltr-nums truncate">{phone}</span>
            </a>
          ) : (
            <span className="text-slate-500">لا يوجد رقم هاتف</span>
          )}
        </div>

        {/* وسوم ثابتة (غير قابلة للنقر) */}
        {(!a.patient || (a.patientNoShowCount ?? 0) >= NO_SHOW_WARNING_THRESHOLD) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!a.patient && <span className="badge shrink-0 border border-slate-200 bg-slate-50 text-slate-500">بدون حساب</span>}
            <NoShowWarningBadge count={a.patientNoShowCount ?? 0} />
          </div>
        )}

        {(a.beneficiary?.type === "FAMILY_MEMBER" || (a.createdBy === "DOCTOR" && a.type === "FOLLOW_UP")) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {a.beneficiary?.type === "FAMILY_MEMBER" && (
              <span className="badge shrink-0 border border-primary-200 bg-primary-50 text-primary-800">
                {a.beneficiary.relationship ? RELATIONSHIP_LABELS[a.beneficiary.relationship as keyof typeof RELATIONSHIP_LABELS] : "فرد عائلة"}
                {a.patient ? ` — حساب ${a.patient.firstName} ${a.patient.lastName}` : ""}
              </span>
            )}
            {a.createdBy === "DOCTOR" && a.type === "FOLLOW_UP" && (
              <span className="badge shrink-0 border border-amber-200 bg-amber-50 text-amber-800">موعد عودة</span>
            )}
          </div>
        )}

        {a.notes && <p className="mt-2 line-clamp-2 break-words text-xs text-slate-600">ملاحظات: {a.notes}</p>}
        {actions.note && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {actions.note}
          </p>
        )}
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
          </>
        )}
        {actions.complete.visible && (
          <Button
            onClick={onComplete}
            disabled={busy || !actions.complete.enabled}
            loading={pending}
            title={actions.complete.reason ?? "المريض حضر وأنهى استشارته"}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> اكتمل الموعد
          </Button>
        )}
        {canManageAttendance && canSendAttendanceMessage(a) && (
          <Button
            variant="outline"
            onClick={onNoShow}
            disabled={busy}
            title="إرسال رسالة دون تغيير الموعد"
          >
            إرسال رسالة
          </Button>
        )}
        {onFollowUp && canScheduleFollowUp(a) && a.status !== "NO_SHOW" && (
          <Button variant="outline" onClick={onFollowUp} disabled={busy} title="إنشاء موعد عودة فعلي لهذا المريض">
            <CalendarPlus className="h-4 w-4" /> برمجة موعد عودة
          </Button>
        )}
        {canManageAttendance && a.status === "NO_SHOW" && (
          <>
            <Button onClick={onArrivedLate} disabled={busy} loading={pending} title="وصل بعد فوات موعده — أدخله الآن">
              <UserCheck className="h-4 w-4" /> حضر متأخرًا
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

function AppointmentsListSection({ filters, onFiltersChange }: { filters: AppointmentFilters; onFiltersChange: (f: AppointmentFilters) => void }) {
  const { user } = useAuth();
  const isAssistant = user?.role === "ASSISTANT";
  const canManageAttendance = useAttendanceActions();
  const { status: filter, from, to } = filters;
  // البحث يُكتب محليًا فورًا ويُحفظ في الرابط بعد توقف الكتابة قليلًا (يبقى عند الرجوع/التنقل).
  const [query, setQuery] = useState(filters.q);
  useEffect(() => setQuery(filters.q), [filters.q]);
  useEffect(() => {
    if (query === filters.q) return;
    const t = setTimeout(() => onFiltersChange({ ...filters, q: query }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const setFilter = (value: StatusFilter) => onFiltersChange({ ...filters, status: value });
  const setRange = (next: { from?: string; to?: string }) => onFiltersChange({ ...filters, ...next });
  const preset = activePreset(from, to);
  const hasFilters = filter !== "ALL" || Boolean(from || to || query);
  const [noShowTarget, setNoShowTarget] = useState<NoShowTarget | null>(null);
  // «برمجة موعد عودة»: النافذة + اقتراح بعد تسجيل «اكتمل الموعد» مباشرة.
  const [followUpCtx, setFollowUpCtx] = useState<FollowUpContext | null>(null);
  const [justCompleted, setJustCompleted] = useState<any | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const openFollowUp = (a: any) =>
    setFollowUpCtx({
      parentAppointmentId: a.id,
      beneficiaryName: patientFullName(a),
      familyMemberId: a.familyMemberId ?? null,
      accountHolderName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : null,
    });

  const { data: appointments, isLoading, isFetching, isError, error, refetch, dataUpdatedAt } = useMyAppointments(
    filter === "ALL" ? undefined : filter,
    { from, to }
  );
  const updateStatus = useUpdateAppointmentStatus();
  const { showToast } = useToast();

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

  async function changeStatus(id: string, status: AppointmentStatus, appointment?: any) {
    if (updateStatus.isPending) return; // منع الإرسال المتكرر
    setPendingId(id);
    try {
      await updateStatus.mutateAsync({ id, status });
      showToast(status === "COMPLETED" ? "سُجّل الموعد مكتملًا." : "تم تحديث حالة الموعد.", "success");
      if (status === "COMPLETED" && appointment && canScheduleFollowUp(appointment) && !isAssistant) setJustCompleted(appointment);
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setPendingId(null);
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

  /**
   * وصل المريض بعد أن سُجّل غيابه: نُعيد نفس الموعد إلى IN_PROGRESS عبر نفس
   * PATCH الحالي — بلا موعد جديد، وبلا سجل غياب جديد، وبلا أي رسالة SMS.
   */
  async function markArrivedLate(id: string) {
    if (updateStatus.isPending) return;
    setPendingId(id);
    try {
      await updateStatus.mutateAsync({ id, status: "IN_PROGRESS" });
      showToast("تم تسجيل حضوره المتأخر — هو الآن المريض الحالي.", "success");
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setPendingId(null);
    }
  }


  return (
    <div className="space-y-4">
      <NoShowSmsDialog target={noShowTarget} onClose={() => setNoShowTarget(null)} />

      {/* الهيدر: العنوان + مؤشر مباشر مُختصر بدل الشرح المطوّل */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-slate-900">إدارة المواعيد</h1>
          <LiveIndicator isFetching={isFetching} updatedAt={dataUpdatedAt} />
        </div>
      </header>

      {/* شريط الأدوات: بحث + فترة زمنية */}
      <div className="card space-y-3 p-3 sm:p-4">
        <div className="relative">
          <label htmlFor="appt-search" className="sr-only">
            بحث في المواعيد
          </label>
          <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            id="appt-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم المريض أو رقم الهاتف..."
            className="input pr-10"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="اختصارات التاريخ">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => setRange(preset === p.key ? { from: undefined, to: undefined } : presetRange(p.key))}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                preset === p.key ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-primary-400"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DateField label="من تاريخ" value={from} max={to} onChange={(v) => setRange({ from: v, to })} />
          <DateField label="إلى تاريخ" value={to} min={from} onChange={(v) => setRange({ from, to: v })} />
        </div>
      </div>

      {/* شرائح الحالة: سطر واحد قابل للتمرير الأفقي داخل حاويته فقط */}
      <div
        role="group"
        aria-label="تصفية حسب الحالة"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={clsx(
              "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition",
              filter === f.value ? "bg-primary-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ملخص الفلاتر المفعّلة + مسحها */}
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700" aria-live="polite">
          <span className="font-semibold">الفلاتر:</span>
          {filter !== "ALL" && <span className="badge bg-slate-100">{FILTERS.find((f) => f.value === filter)?.label}</span>}
          {(from || to) && (
            <span className="badge bg-slate-100">
              {from && to && from === to ? formatDayAr(from) : `${from ? formatDayAr(from, { weekday: false }) : "…"} ← ${to ? formatDayAr(to, { weekday: false }) : "…"}`}
            </span>
          )}
          {query && <span className="badge bg-slate-100">بحث: {query}</span>}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onFiltersChange({ ...filters, status: "ALL", from: undefined, to: undefined, q: "" });
            }}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-200"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> مسح الفلاتر
          </button>
          {visible && <span className="text-slate-600">· {visible.length} نتيجة</span>}
        </div>
      )}

      {justCompleted && (
        <div className="card flex flex-col gap-2 border-primary-200 bg-primary-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="status">
          <span>
            اكتمل موعد <b>{patientFullName(justCompleted)}</b>. هل تريد برمجة موعد عودة؟
          </span>
          <div className="flex gap-2">
            <Button onClick={() => { openFollowUp(justCompleted); setJustCompleted(null); }}>
              <CalendarPlus className="h-4 w-4" /> برمجة موعد عودة
            </Button>
            <Button variant="ghost" onClick={() => setJustCompleted(null)}>لاحقًا</Button>
          </div>
        </div>
      )}

      <FollowUpModal open={Boolean(followUpCtx)} ctx={followUpCtx} onClose={() => setFollowUpCtx(null)} />

      {isLoading && !appointments ? (
        <SkeletonRows label="جارٍ تحميل المواعيد..." />
      ) : isError && !appointments ? (
        <ErrorState message={apiErrorMessage(error, "تعذّر تحميل المواعيد.")} onRetry={() => void refetch()} />
      ) : visible && visible.length > 0 ? (
        <div className={clsx("space-y-3 transition-opacity", isFetching && "opacity-80")} aria-busy={isFetching}>
          {visible.map((a: any) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              canManageAttendance={canManageAttendance}
          role={user?.role === "ASSISTANT" ? "ASSISTANT" : "DOCTOR"}
              onComplete={() => changeStatus(a.id, "COMPLETED", a)}
              onNoShow={() => openNoShow(a)}
              onArrivedLate={() => markArrivedLate(a.id)}
              busy={updateStatus.isPending}
              pending={pendingId === a.id}
              onFollowUp={isAssistant ? undefined : () => openFollowUp(a)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={query ? "لا نتائج مطابقة للبحث" : hasFilters ? "لا توجد مواعيد مطابقة للفلاتر" : "لا توجد مواعيد"}
          description={hasFilters ? "جرّب مسح الفلاتر أو تغيير الفترة." : undefined}
        />
      )}
    </div>
  );
}

const APPOINTMENTS_TABS: { key: "queue" | "list"; label: string }[] = [
  { key: "queue", label: "طابور اليوم" },
  { key: "list", label: "كل المواعيد" },
];

/**
 * صفحة موحّدة بقسمين: "طابور اليوم" (القائمة الحية للنداء/التأجيل/الوصول) و"كل المواعيد"
 * (تصفّح كامل مع بحث وفلاتر وتذكير واتساب). القسمان مصدرا بيانات مختلفان تمامًا (useQueue
 * مقابل useMyAppointments)، لذا نُركّب أحدهما فقط في كل لحظة (وليس نخفيه بـCSS) حتى يتوقف
 * التحديث الدوري (refetchInterval) للقسم غير الظاهر تلقائيًا، بلا أي استقطاب مضاعف للخادم.
 */
export default function DoctorAppointments() {
  // التبويب والفلاتر محفوظة في الرابط: الدخول الطبيعي = طابور اليوم و«الكل»، وبطاقات الإحصاءات
  // تفتح «كل المواعيد» بالفلتر الصريح نفسه، ويبقى كل شيء عند التحديث أو الرجوع.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseAppointmentFilters(searchParams), [searchParams]);
  const update = (next: AppointmentFilters) => setSearchParams(serializeAppointmentFilters(next), { replace: true });
  const tab = filters.tab;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="أقسام المواعيد" className="flex w-fit gap-1 rounded-full bg-slate-100 p-1">
        {APPOINTMENTS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => update({ ...filters, tab: t.key })}
            className={clsx(
              "rounded-full px-4 py-1.5 text-sm font-semibold transition",
              tab === t.key ? "bg-white text-primary-700 shadow-sm" : "text-slate-600 hover:text-slate-800"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "queue" ? <DoctorQueue /> : <AppointmentsListSection filters={filters} onFiltersChange={update} />}
    </div>
  );
}
