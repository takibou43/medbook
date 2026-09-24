import { AppointmentStatus, Prisma, PrismaClient } from "@prisma/client";
import { projectQueueOrder } from "./queueOrder";
import { ALGERIA_OFFSET_MINUTES, closingTimeForDate } from "./slots";

/**
 * «هل الموعد موجود فعلًا في طابور الطبيب الآن؟» — تعريف واحد مشترك، مأخوذ حرفيًا من المنطق القائم:
 *
 *  - طابور اليوم = مواعيد الطبيب في يوم الجزائر الحالي بالحالات CONFIRMED + LATE + IN_PROGRESS
 *    (نفس فلتر getQueueForDoctor و callNextPatient وصفحة «حالة دوري» getAppointmentQueueStatus).
 *  - المنتظرون = CONFIRMED + LATE، مرتَّبين بـ projectQueueOrder (lib/queueOrder.ts) أي بنفس قواعد
 *    المناداة الفعلية، بما فيها تراجع المتأخر LATE مركزين ثم 4 مراكز (skipCredits).
 *  - IN_PROGRESS = المريض بالداخل مع الطبيب (ليس «منتظرًا»).
 *  - PENDING ليس في الطابور (لا يظهر في لوحة الطبيب ولا يُنادى)، و COMPLETED/CANCELLED/NO_SHOW خرجوا منه.
 *  - بعد وقت إغلاق الطبيب لذلك اليوم يخرج الجميع من الطابور (autoExpireStaleAppointments يحوّلهم إلى
 *    NO_SHOW/COMPLETED) — نطبّق نفس القاعدة هنا حتى لو لم يمر الكنس الدوري بعد.
 *
 * لا تعريف جديد للطابور: هذه الدوال تُستعمل الآن من صفحة «حالة دوري» ومن التذكيرات معًا.
 */

export const WAITING_QUEUE_STATUSES: AppointmentStatus[] = [AppointmentStatus.CONFIRMED, AppointmentStatus.LATE];
export const DAY_QUEUE_STATUSES: AppointmentStatus[] = [...WAITING_QUEUE_STATUSES, AppointmentStatus.IN_PROGRESS];

const MINUTE_MS = 60 * 1000;

export interface DayQueueRow {
  id: string;
  startTime: string;
  status: AppointmentStatus;
  skipCredits: number;
  calledAt: Date | null;
}

export interface QueuePosition {
  /** الموعد ضمن المنتظرين (CONFIRMED/LATE) في طابور اليوم. */
  waiting: boolean;
  /** الموعد هو المريض الموجود حاليًا مع الطبيب. */
  inProgress: boolean;
  /** ترتيبه بين المنتظرين (0 = التالي). -1 إن لم يكن منتظرًا. */
  index: number;
  /** مريض آخر بالداخل الآن. */
  insideOther: boolean;
  /** calledAt للمريض الموجود بالداخل (غيره) إن وُجد. */
  currentCalledAt: Date | null;
  /** من يسبقه فعليًا = من بالداخل + من يسبقه في ترتيب المناداة (نفس حساب صفحة «حالة دوري»). */
  aheadOfYou: number;
}

/** دالة نقية: موقع موعد في طابور يوم (بلا قاعدة بيانات). */
export function locateInQueue(dayQueue: DayQueueRow[], appointmentId: string): QueuePosition {
  const inside = dayQueue.filter((a) => a.status === AppointmentStatus.IN_PROGRESS);
  const insideOtherRow = inside.find((a) => a.id !== appointmentId) ?? null;
  const order = projectQueueOrder(dayQueue.filter((a) => WAITING_QUEUE_STATUSES.includes(a.status)));
  const index = order.findIndex((a) => a.id === appointmentId);
  const insideOther = Boolean(insideOtherRow);
  return {
    waiting: index >= 0,
    inProgress: inside.some((a) => a.id === appointmentId),
    index,
    insideOther,
    currentCalledAt: insideOtherRow?.calledAt ?? null,
    aheadOfYou: index >= 0 ? index + (insideOther ? 1 : 0) : 0,
  };
}

/** لحظة (UTC) لوقت "HH:mm" بتوقيت الجزائر في يوم موعد (عمود date = منتصف الليل UTC). */
export function algeriaTimeOnDay(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, 0, 0) - ALGERIA_OFFSET_MINUTES * MINUTE_MS);
}

/** يوم الجزائر (منتصف الليل UTC) الذي تقع فيه لحظة معيّنة. */
export function algeriaDayStart(instant: Date): Date {
  const shifted = new Date(instant.getTime() + ALGERIA_OFFSET_MINUTES * MINUTE_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

type ScheduleLike = Parameters<typeof closingTimeForDate>[1];

/** هل انتهى دوام الطبيب لذلك اليوم عند now؟ (نفس قاعدة autoExpireStaleAppointments: وقت الإغلاق، وإلا 23:59). */
export function isQueueDayClosed(day: Date, schedules: ScheduleLike, now: Date): boolean {
  const closing = closingTimeForDate(day, schedules) ?? "23:59";
  return algeriaTimeOnDay(day, closing).getTime() < now.getTime();
}

type Db = PrismaClient | Prisma.TransactionClient;

export interface DoctorDayQueue {
  day: Date;
  closed: boolean;
  rows: DayQueueRow[];
  /** آخر نشاط مناداة/إنهاء للطبيب اليوم — لمعرفة هل العيادة «تعمل» الآن. */
  lastActivityAt: Date | null;
}

/** يقرأ طابور يوم الطبيب من قاعدة البيانات مباشرة (لا كاش ولا بيانات من المتصفح). */
export async function loadDoctorDayQueue(db: Db, doctorId: string, now: Date): Promise<DoctorDayQueue> {
  const day = algeriaDayStart(now);
  const end = new Date(day.getTime() + 24 * 60 * MINUTE_MS - 1);
  const [doctor, rows, activity] = await Promise.all([
    db.doctor.findUnique({ where: { id: doctorId }, select: { schedules: true } }),
    db.appointment.findMany({
      where: { doctorId, date: { gte: day, lte: end }, status: { in: DAY_QUEUE_STATUSES } },
      select: { id: true, startTime: true, status: true, skipCredits: true, calledAt: true },
      orderBy: [{ startTime: "asc" }],
    }),
    db.appointment.aggregate({
      where: { doctorId, date: { gte: day, lte: end } },
      _max: { calledAt: true, endedAt: true },
    }),
  ]);
  const closed = doctor ? isQueueDayClosed(day, doctor.schedules, now) : true;
  const times = [activity._max.calledAt, activity._max.endedAt].filter((d): d is Date => Boolean(d));
  const lastActivityAt = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
  // بعد الإغلاق لا أحد في الطابور (نفس نتيجة الكنس الذي سيحوّلهم إلى NO_SHOW/COMPLETED).
  return { day, closed, rows: closed ? [] : rows, lastActivityAt };
}

// ===== تقدير وقت الدور (لتنبيه «دورك اقترب») =====

/** أقل ما نفترضه متبقيًا للمريض الموجود بالداخل: إن تجاوز الطبيب المدة المعتادة فقد ينهي في أي لحظة. */
export const MIN_REMAINING_CURRENT_MINUTES = 1;

/**
 * الوقت المتوقع (بالدقائق من now) حتى يُنادى هذا المريض — دالة نقية.
 *   = ما تبقّى للمريض الموجود بالداخل (المدة الذكية − ما مضى منذ مناداته، بحد أدنى دقيقة)
 *   + عدد المنتظرين قبله في ترتيب المناداة الفعلي × المدة الذكية.
 * المدة الذكية = estimateSessionMinutes (متوسط آخر الجلسات الحقيقية للطبيب) — نفس ما تعرضه صفحة «حالة دوري».
 * null إن لم يكن المريض منتظرًا في الطابور.
 */
export function estimateMinutesUntilTurn(pos: QueuePosition, sessionMinutes: number, now: Date): number | null {
  if (!pos.waiting) return null;
  let remainingCurrent = 0;
  if (pos.insideOther) {
    const elapsed = pos.currentCalledAt ? (now.getTime() - pos.currentCalledAt.getTime()) / MINUTE_MS : 0;
    remainingCurrent = Math.max(MIN_REMAINING_CURRENT_MINUTES, Math.min(sessionMinutes, sessionMinutes - elapsed));
  }
  return remainingCurrent + pos.index * sessionMinutes;
}
