import type { AppointmentStatus, Role } from "../types/index.ts";

/**
 * مساعدات نقية لواجهة الطبيب (تواريخ، فلاتر المواعيد، الإجراءات المسموحة حسب الحالة والتوقيت).
 * تُختبر بـnode --test. الخادم يبقى المرجع: هذه القواعد مرآة لـbackend/src/lib/appointmentTiming.ts
 * وALLOWED_TRANSITIONS، لإخفاء/تعطيل الأزرار مع سبب مفهوم قبل أن يرفضها الخادم.
 */

export const ALGERIA_OFFSET_MS = 60 * 60 * 1000;

/** "YYYY-MM-DD" لليوم بتوقيت الجزائر. */
export function algeriaToday(now = Date.now()): string {
  return new Date(now + ALGERIA_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** يوم الموعد كما يخزّنه الخادم (00:00 UTC = التاريخ التقويمي الجزائري). */
export function appointmentDay(dateStr: string): string {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** لحظة بدء الموعد (ms UTC) من تاريخه ووقته بتوقيت الجزائر. */
export function appointmentStartMs(dateStr: string, startTime: string): number {
  const day = appointmentDay(dateStr);
  const [h, m] = (startTime || "00:00").split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, h || 0, m || 0) - ALGERIA_OFFSET_MS;
}

export interface DateRange {
  from: string;
  to: string;
}

/** الشهر الميلادي الحالي (بتوقيت الجزائر) من أوله إلى آخره. */
export function monthRange(now = Date.now()): DateRange {
  const today = algeriaToday(now);
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

/** الأسبوع الحالي: من السبت إلى الجمعة (أسبوع العمل المعتمد في الجزائر). */
export function weekRange(now = Date.now()): DateRange {
  const today = algeriaToday(now);
  const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0=الأحد … 6=السبت
  const sinceSaturday = (dow + 1) % 7;
  const from = shiftDay(today, -sinceSaturday);
  return { from, to: shiftDay(from, 6) };
}

const AR_MONTHS = ["جانفي", "فيفري", "مارس", "أفريل", "ماي", "جوان", "جويلية", "أوت", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const AR_WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** "الخميس 2 أكتوبر 2026" — صيغة عربية موحّدة (أسماء الأشهر الجزائرية) بأرقام لاتينية مقروءة. */
export function formatDayAr(day: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const d = new Date(day + "T00:00:00Z");
  const parts = [opts.weekday === false ? "" : AR_WEEKDAYS[d.getUTCDay()], String(d.getUTCDate()), AR_MONTHS[d.getUTCMonth()]];
  if (opts.year !== false) parts.push(String(d.getUTCFullYear()));
  return parts.filter(Boolean).join(" ");
}

/** "اليوم" / "غدًا" / "أمس" أو التاريخ الكامل. */
export function relativeDayAr(day: string, now = Date.now()): string {
  const today = algeriaToday(now);
  if (day === today) return "اليوم";
  if (day === shiftDay(today, 1)) return "غدًا";
  if (day === shiftDay(today, -1)) return "أمس";
  return formatDayAr(day, { year: day.slice(0, 4) !== today.slice(0, 4) });
}

// ---------------- فلاتر صفحة المواعيد (من الرابط وإليه) ----------------

export type StatusFilter = AppointmentStatus | "ALL";
export type AppointmentsTab = "queue" | "list";

export interface AppointmentFilters {
  tab: AppointmentsTab;
  status: StatusFilter;
  from?: string;
  to?: string;
  q: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: StatusFilter[] = ["ALL", "PENDING", "CONFIRMED", "RESCHEDULE_REQUIRED", "IN_PROGRESS", "LATE", "COMPLETED", "CANCELLED", "NO_SHOW"];

/**
 * قراءة الفلاتر من الرابط. الدخول الطبيعي (بلا معاملات) = تبويب الطابور، وفي «كل المواعيد» الحالة «الكل».
 * أي فلتر صريح في الرابط (status/date/from/to — من بطاقات الإحصاءات) يفتح «كل المواعيد» مباشرة ويُحترم.
 * date=X (الصيغة القديمة) تعني from=X وto=X.
 */
export function parseAppointmentFilters(search: string | URLSearchParams): AppointmentFilters {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  const rawStatus = p.get("status");
  const status: StatusFilter = rawStatus && (STATUSES as string[]).includes(rawStatus) ? (rawStatus as StatusFilter) : "ALL";
  const date = p.get("date");
  let from = p.get("from") ?? undefined;
  let to = p.get("to") ?? undefined;
  if (date && DAY_RE.test(date)) {
    from = date;
    to = date;
  }
  if (from && !DAY_RE.test(from)) from = undefined;
  if (to && !DAY_RE.test(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  const hasExplicit = Boolean(rawStatus || from || to);
  const tabParam = p.get("tab");
  const tab: AppointmentsTab = tabParam === "list" || tabParam === "queue" ? tabParam : hasExplicit ? "list" : "queue";
  return { tab, status, from, to, q: p.get("q") ?? "" };
}

export function serializeAppointmentFilters(f: AppointmentFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set("tab", f.tab);
  if (f.tab === "list") {
    if (f.status !== "ALL") p.set("status", f.status);
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
    if (f.q.trim()) p.set("q", f.q.trim());
  }
  return p;
}

/** رابط «كل المواعيد» بفلاتر محددة (لبطاقات الإحصاءات). */
export function appointmentsLink(f: Partial<Omit<AppointmentFilters, "tab">> = {}): string {
  return "/appointments?" + serializeAppointmentFilters({ tab: "list", status: "ALL", q: "", ...f }).toString();
}

export type DatePreset = "today" | "week" | "month";

export function presetRange(preset: DatePreset, now = Date.now()): DateRange {
  if (preset === "today") {
    const t = algeriaToday(now);
    return { from: t, to: t };
  }
  return preset === "week" ? weekRange(now) : monthRange(now);
}

export function activePreset(from: string | undefined, to: string | undefined, now = Date.now()): DatePreset | null {
  if (!from || !to) return null;
  for (const p of ["today", "week", "month"] as DatePreset[]) {
    const r = presetRange(p, now);
    if (r.from === from && r.to === to) return p;
  }
  return null;
}

// ---------------- الإجراءات المسموحة على موعد ----------------

export interface ActionState {
  /** يظهر الزر أصلًا؟ */
  visible: boolean;
  /** مفعّل؟ إن لا، `reason` يشرح السبب للمستخدم. */
  enabled: boolean;
  reason?: string;
}

export interface AppointmentActions {
  complete: ActionState;
  noShow: ActionState;
  /** ملاحظة عامة تُعرض بدل الأزرار (مثل: «الإجراءات تتاح يوم الموعد»). */
  note?: string;
}

const HIDDEN: ActionState = { visible: false, enabled: false };

/**
 * الإجراءات المناسبة لحالة الموعد وتوقيته — مرآة لقيود الخادم:
 *  - «اكتمل الموعد» (COMPLETED، كانت «حضر»): للطبيب فقط، من CONFIRMED/IN_PROGRESS/LATE، وليس لموعد يومه لم يأتِ، ولا لموعد مؤكد اليوم قبل ساعته (إلا إذا استُدعي المريض: IN_PROGRESS/LATE).
 *  - «لم يحضر» (NO_SHOW): من CONFIRMED/IN_PROGRESS/LATE، وليس قبل حلول وقت الموعد.
 *  - PENDING: الخادم لا يسمح منها إلا بالتأكيد أو الإلغاء، فلا تظهر الزران.
 */
export function appointmentActions(
  a: { status: AppointmentStatus; date: string; startTime: string },
  role: Role | undefined,
  now = Date.now()
): AppointmentActions {
  const actionable = a.status === "CONFIRMED" || a.status === "IN_PROGRESS" || a.status === "LATE";
  if (!actionable) return { complete: HIDDEN, noShow: HIDDEN };

  const day = appointmentDay(a.date);
  const today = algeriaToday(now);
  if (day > today) {
    return { complete: HIDDEN, noShow: HIDDEN, note: "تسجيل الحضور أو الغياب يتاح يوم الموعد." };
  }

  const calledToday = day === today && (a.status === "IN_PROGRESS" || a.status === "LATE");
  const started = appointmentStartMs(a.date, a.startTime) <= now;
  const complete: ActionState =
    role !== "DOCTOR"
      ? HIDDEN
      : started || calledToday
        ? { visible: true, enabled: true }
        : { visible: true, enabled: false, reason: `لا يمكن إنهاء الموعد قبل وقته (${a.startTime}) ما لم يُستدعَ المريض.` };
  const noShow: ActionState =
    started || calledToday
      ? { visible: true, enabled: true }
      : { visible: true, enabled: false, reason: `لا يمكن تسجيل الغياب قبل وقت الموعد (${a.startTime}).` };
  return { complete, noShow };
}

// ---------------- نصوص ----------------

/** "طبيب واحد" / "طبيبان" / "3 أطباء" / "11 طبيبًا". */
export function doctorsCountAr(n: number): string {
  if (n === 0) return "لا أطباء";
  if (n === 1) return "طبيب واحد";
  if (n === 2) return "طبيبان";
  if (n >= 3 && n <= 10) return `${n} أطباء`;
  return `${n} طبيبًا`;
}

/** "موعد واحد" / "موعدان" / "3 مواعيد" / "11 موعدًا". */
export function appointmentsCountAr(n: number): string {
  if (n === 0) return "لا مواعيد";
  if (n === 1) return "موعد واحد";
  if (n === 2) return "موعدان";
  if (n >= 3 && n <= 10) return `${n} مواعيد`;
  return `${n} موعدًا`;
}

/** مبلغ بالدينار بأرقام مقروءة: "4 000 دج". */
export function formatDzd(value: number | null | undefined): string {
  return `${Math.round(value ?? 0).toLocaleString("fr-DZ").replace(/ | /g, " ")} دج`;
}

// ---------------- سعر الموعد ونسبة الطبيب في العيادة ----------------
// نفس معادلة الخادم تمامًا (backend/src/lib/clinicFinance.ts): التقريب لأقرب دينار والباقي للعيادة.
// للعرض والمعاينة فقط — الحساب الفعلي والتحقق في الخادم.

export function splitDzd(priceDzd: number, doctorSharePercent: number): { doctorDzd: number; clinicDzd: number } {
  const doctorDzd = Math.floor((priceDzd * doctorSharePercent + 50) / 100);
  return { doctorDzd, clinicDzd: priceDzd - doctorDzd };
}

/** نسبة العيادة = المتبقي من نسبة الطبيب؛ null إن لم تُحدَّد نسبة الطبيب. */
export function clinicSharePercentOf(doctorSharePercent: number | null | undefined): number | null {
  return doctorSharePercent == null ? null : 100 - doctorSharePercent;
}

/** "80%" أو "غير محددة". */
export function formatPercent(value: number | null | undefined): string {
  return value == null ? "غير محددة" : `${value}%`;
}

/** مثال حي بالدينار: "من كل موعد: الطبيب 1 600 دج · العيادة 400 دج". */
export function termsExampleAr(priceDzd: number | null | undefined, doctorSharePercent: number | null | undefined): string | null {
  if (priceDzd == null || doctorSharePercent == null) return null;
  const { doctorDzd, clinicDzd } = splitDzd(priceDzd, doctorSharePercent);
  return `من كل موعد بسعر ${formatDzd(priceDzd)}: الطبيب ${formatDzd(doctorDzd)} · العيادة ${formatDzd(clinicDzd)}`;
}

export type TermsFormResult =
  | { ok: true; value: { appointmentPriceDzd: number; doctorSharePercent: number } }
  | { ok: false; error: string };

/** تحقق الواجهة قبل الإرسال (الخادم يعيد التحقق دائمًا): سعر عدد صحيح موجب، ونسبة صحيحة بين 0 و100. */
export function parseTermsForm(priceText: string, shareText: string): TermsFormResult {
  const price = priceText.trim();
  const share = shareText.trim();
  if (!/^\d{1,8}$/.test(price) || Number(price) > 10_000_000) return { ok: false, error: "سعر الموعد يجب أن يكون عددًا صحيحًا موجبًا بالدينار." };
  if (!/^\d{1,3}$/.test(share) || Number(share) > 100) return { ok: false, error: "نسبة الطبيب يجب أن تكون عددًا صحيحًا بين 0 و100." };
  return { ok: true, value: { appointmentPriceDzd: Number(price), doctorSharePercent: Number(share) } };
}
