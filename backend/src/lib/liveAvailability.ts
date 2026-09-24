import { AppointmentStatus } from "@prisma/client";
import { ALGERIA_OFFSET_MINUTES, ScheduleBlock, generateAvailableSlots, isPast } from "./slots";

/**
 * توفر المواعيد حسب الحالة الفعلية لطابور الطبيب (اليوم الحالي فقط).
 *
 * المشكلة: شبكة الأوقات (generateAvailableSlots) تعتبر كل موعد غير ملغى شاغلًا لوقته، حتى المواعيد
 * المكتملة التي أنهاها الطبيب قبل وقتها. طبيب أنهى كل مرضى اليوم مبكرًا وما زال في دوامه كان يظهر
 * «ممتلئًا» فيُدفع المريض إلى الغد.
 *
 * القاعدة («الوضع الحي»): اليوم هو يوم الجزائر الحالي، ولا يوجد أحد في الطابور الآن:
 *   - لا IN_PROGRESS (الطبيب مع مريض)،
 *   - لا LATE (المتأخر يبقى في الطابور حسب منطق LATE الحالي)،
 *   - لا PENDING/CONFIRMED حلّ وقته ولم يُنادَ بعد (مريض ينتظر فعلًا).
 * عندها تُضاف إلى أوقات الشبكة الشاغرة (كما هي دون تغيير) «أوقات حية» في الفراغات التي تركتها مواعيد
 * انتهت فعلًا، من الآن حتى نهاية دوام اليوم:
 *   - يحجب: المواعيد النشطة القادمة اليوم (PENDING/CONFIRMED) وأوقات الشبكة الشاغرة نفسها (فلا تتداخل).
 *   - لا يحجب: COMPLETED و NO_SHOW (انتهت، ليست في الطابور) و CANCELLED (يحرّر وقته كما هو الحال).
 *   - وقت البداية نفسه لأي موعد غير ملغى لا يُعاد استعماله (القيد الفريد doctorId+date+startTime+activeSlot
 *     في قاعدة البيانات)، فلا يُعرض وقت ترفضه القاعدة.
 * الأوقات الحية: من «الآن» مقرّبًا لأعلى إلى مضاعف 5 دقائق (لا وقت في الماضي)، بمدة جلسة الطبيب، داخل فترات
 * العمل فقط (الاستراحات والاستثناءات كما في الشبكة). يوم بلا مواعيد منتهية مبكرًا لا تظهر فيه أي أوقات حية
 * (الفراغ قبل أول وقت شبكة قادم أقصر من مدة الجلسة)، فسلوكه كما كان تمامًا. غير اليوم، أو الطابور غير فارغ:
 * الشبكة وحدها كما كانت.
 *
 * هذه الدالة نقية؛ الحجز النهائي يعيد حسابها داخل معاملة تحت قفل طابور الطبيب، والقيد الفريد خط دفاع أخير.
 */

export const QUEUE_ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.LATE,
];
export const LIVE_STEP_MINUTES = 5;

export interface DayAppointment {
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
}

export interface DayAvailability {
  slots: string[];
  // true = أُضيفت أوقات حية من حالة الطابور الفعلية، false = شبكة الأوقات المعتادة وحدها.
  live: boolean;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

function sameDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** فترات العمل الفعلية ليوم معيّن (نفس قواعد generateAvailableSlots: استثناء عطلة يلغي اليوم، واستثناء عمل يستبدل). */
export function workingBlocksFor(date: Date, schedules: ScheduleBlock[]): { start: number; end: number }[] {
  if (schedules.some((s) => s.isException && s.exceptionDate && sameDay(s.exceptionDate, date) && s.isOff)) return [];
  const dow = date.getUTCDay();
  return schedules
    .filter((s) => (s.isException ? Boolean(s.exceptionDate && sameDay(s.exceptionDate, date) && !s.isOff) : s.dayOfWeek === dow && !s.isOff))
    .map((s) => ({ start: toMinutes(s.startTime), end: toMinutes(s.endTime) }))
    .sort((a, b) => a.start - b.start);
}

/** «الآن» بتوقيت الجزائر: يوم الجزائر (منتصف الليل UTC) + الدقيقة داخل اليوم. */
export function algeriaClock(nowMs: number): { day: Date; minute: number; second: number } {
  const shifted = new Date(nowMs + ALGERIA_OFFSET_MINUTES * 60000);
  return {
    day: new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds() + shifted.getUTCMilliseconds() / 1000,
  };
}

/** هل في الطابور أحد الآن؟ (IN_PROGRESS أو LATE أو موعد نشط حلّ وقته). */
export function queueHasPatientsNow(appts: DayAppointment[], nowMinute: number): boolean {
  return appts.some(
    (a) =>
      a.status === AppointmentStatus.IN_PROGRESS ||
      a.status === AppointmentStatus.LATE ||
      ((a.status === AppointmentStatus.PENDING || a.status === AppointmentStatus.CONFIRMED) && toMinutes(a.startTime) <= nowMinute)
  );
}

/** أول دقيقة يمكن أن يبدأ عندها موعد حي: بعد «الآن» (لا ماضٍ)، مقرّبة لأعلى لمضاعف 5 دقائق. */
export function liveEarliestMinute(nowMinute: number, nowSecond: number): number {
  const base = nowSecond > 0 ? nowMinute + 1 : nowMinute;
  return Math.ceil(base / LIVE_STEP_MINUTES) * LIVE_STEP_MINUTES;
}

/**
 * الأوقات الحية الإضافية لليوم الحالي، متسلسلة بلا تداخل: كل وقت يبدأ بعد نهاية سابقه أو بعد نهاية ما يحجبه.
 * reserved = أوقات الشبكة الشاغرة (تبقى كما هي وتُعامل كمحجوزة هنا حتى لا تتداخل معها الأوقات الحية).
 * null = الوضع الحي لا ينطبق (ليس اليوم، أو الطابور غير فارغ).
 */
export function computeLiveSlots(opts: {
  date: Date;
  schedules: ScheduleBlock[];
  appointments: DayAppointment[]; // مواعيد اليوم (الملغاة تُتجاهل إن مُرّرت)
  slotMinutes: number;
  nowMs: number;
  reserved?: string[];
}): string[] | null {
  const { date, schedules, slotMinutes, nowMs } = opts;
  const appts = opts.appointments.filter((a) => a.status !== AppointmentStatus.CANCELLED);
  const clock = algeriaClock(nowMs);
  if (!sameDay(date, clock.day)) return null;
  if (queueHasPatientsNow(appts, clock.minute)) return null;

  const blocks = workingBlocksFor(date, schedules);
  if (blocks.length === 0) return [];

  // بعد فحص الطابور لم يبقَ من النشط إلا القادم (PENDING/CONFIRMED) — يحجب فترته. ومعه أوقات الشبكة الشاغرة.
  const blocking = [
    ...appts.filter((a) => QUEUE_ACTIVE_STATUSES.includes(a.status)).map((a) => [toMinutes(a.startTime), toMinutes(a.endTime)] as const),
    ...(opts.reserved ?? []).map((st) => [toMinutes(st), toMinutes(st) + slotMinutes] as const),
  ].sort((x, y) => x[0] - y[0]);
  const usedStarts = new Set(appts.map((a) => a.startTime));

  const slots: string[] = [];
  let t = liveEarliestMinute(clock.minute, clock.second);
  for (const block of blocks) {
    if (t < block.start) t = block.start;
    while (t + slotMinutes <= block.end) {
      const end = t + slotMinutes;
      const clash = blocking.find(([s, e]) => t < e && s < end);
      if (clash) {
        t = Math.max(t + 1, clash[1]);
        continue;
      }
      if (usedStarts.has(toHHMM(t))) {
        // نفس بداية موعد مكتمل/غائب (قيد فريد): نزحزح دقيقة واحدة بدل ترك الفترة كلها.
        t += 1;
        continue;
      }
      slots.push(toHHMM(t));
      t = end;
    }
  }
  return slots;
}

/**
 * التوفر الموحّد ليوم معيّن — نفس الدالة للعرض (availability) وللحجز بوقت (تحت القفل):
 * أوقات الشبكة الشاغرة (بلا الماضي) كما كانت تمامًا + الأوقات الحية إن انطبق الوضع الحي.
 */
export function dayAvailability(opts: {
  date: Date;
  schedules: ScheduleBlock[];
  appointments: DayAppointment[];
  slotMinutes: number;
  nowMs?: number;
  isPastFn?: (date: Date, hhmm: string) => boolean;
}): DayAvailability {
  const nowMs = opts.nowMs ?? Date.now();
  const occupying = opts.appointments.filter((a) => a.status !== AppointmentStatus.CANCELLED);
  const pastFn = opts.isPastFn ?? isPast;
  const grid = generateAvailableSlots(opts.date, opts.schedules, occupying, opts.slotMinutes).filter((s) => !pastFn(opts.date, s));
  const live = computeLiveSlots({ ...opts, nowMs, reserved: grid });
  if (!live || live.length === 0) return { slots: grid, live: false };
  const merged = Array.from(new Set([...grid, ...live])).sort((a, b) => toMinutes(a) - toMinutes(b));
  return { slots: merged, live: true };
}
