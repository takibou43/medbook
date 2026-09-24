import { AppointmentStatus, ReminderStatus, ReminderType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { sendPushToUser, isPushEnabled, PushPayload } from "../../lib/push";
import { FIVE_MINUTE_ALARM_KIND, QUEUE_APPROACH_ALARM_KIND } from "../../lib/pushKinds";
import {
  WAITING_QUEUE_STATUSES,
  loadDoctorDayQueue,
  locateInQueue,
  estimateMinutesUntilTurn,
  DoctorDayQueue,
} from "../../lib/doctorQueue";
import { estimateSessionMinutes } from "../appointments/appointments.service";
import { ALGERIA_OFFSET_MINUTES } from "../../lib/slots";
import { appointmentDayEndsAt, appointmentNotificationTag } from "../../lib/appointmentExpiry";

/**
 * تذكيرات مواعيد المرضى عبر Web Push: تذكير قبل الموعد بساعة، وآخر قبله بخمس دقائق.
 *
 * كيف نضمن عدم الإرسال مرتين؟
 *  1) سجل واحد فقط لكل (موعد + نوع) بفضل القيد الفريد في قاعدة البيانات (createMany + skipDuplicates).
 *  2) قبل الإرسال "نحجز" السجل ذرّيًا: updateMany({ id, status: PENDING } → PROCESSING). مُشغِّل واحد
 *     فقط يحصل على count = 1 حتى لو اشتغل الـscheduler مرتين في نفس اللحظة أو على نسختين من الخادم.
 *  3) أي حالة غير PENDING نهائية: لا إعادة محاولة (الأفضل تفويت تذكير على إزعاج المريض بتكراره).
 *
 * كيف نضمن عدم التذكير بموعد ملغى/مكتمل/غائب؟ حالة الموعد تُقرأ من جديد لحظة المعالجة
 * (لا نعتمد على ما كانت عليه عند إنشاء السجل)، وكل ما ليس PENDING/CONFIRMED يُتخطّى.
 *
 * التوقيت: عمود date يحمل يوم الموعد بتوقيت الجزائر (منتصف الليل UTC) و startTime "HH:mm" بتوقيت
 * الجزائر (UTC+1 ثابت، بلا توقيت صيفي) — نفس القاعدة المستعملة في lib/slots.ts.
 */

// تذكيرات مربوطة بوقت الموعد. («دورك اقترب» QUEUE_APPROACH ليس مربوطًا بالوقت — انظر processQueueApproach.)
export type TimedReminderType = typeof ReminderType.ONE_HOUR | typeof ReminderType.FIVE_MINUTES;

export const REMINDER_OFFSET_MINUTES: Record<TimedReminderType, number> = {
  ONE_HOUR: 60,
  FIVE_MINUTES: 5,
};

export const FIVE_MINUTE_REMINDER_TITLE = "موعدك مع الطبيب بعد 5 دقائق";

export const REMINDER_TYPES: TimedReminderType[] = [ReminderType.ONE_HOUR, ReminderType.FIVE_MINUTES];

export const QUEUE_APPROACH_TITLE = "دورك اقترب";
export const QUEUE_APPROACH_BODY = "دورك اقترب، يرجى الاستعداد والتوجه إلى الطبيب.";

// التذكير فقط للمواعيد القادمة التي لم تُحسم بعد. LATE/IN_PROGRESS تعني أن المريض في العيادة أصلًا،
// و COMPLETED/CANCELLED/NO_SHOW انتهت — لا تذكير لأي منها.
// (تذكير الساعة — كما كان تمامًا.)
export const REMINDABLE_STATUSES: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];

// تذكير الخمس دقائق لا يعتمد على الحالة وحدها: يُرسل فقط إن كان الموعد منتظرًا فعلًا في طابور الطبيب
// لحظة الإرسال (CONFIRMED أو LATE، يوم الجزائر الحالي، قبل إغلاق الدوام) — انظر lib/doctorQueue.ts.
// لذلك تُنشأ سجلاته أيضًا للمواعيد LATE (متأخر أُعيد إلى الخلف ما زال في الطابور).
const ROW_CREATION_STATUSES: AppointmentStatus[] = [...REMINDABLE_STATUSES, AppointmentStatus.LATE];

// ننشئ سجلات التذكير للمواعيد التي تبدأ خلال هذه النافذة (أكبر من أطول تذكير، ساعة).
const LOOKAHEAD_MS = 2 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
const MINUTE_MS = 60 * 1000;

/** لحظة بداية الموعد الفعلية (UTC) من يوم الموعد + وقت البداية بتوقيت الجزائر. */
export function appointmentStartUtc(date: Date, startTime: string): Date {
  const [h, m] = startTime.split(":").map(Number);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m, 0, 0) - ALGERIA_OFFSET_MINUTES * MINUTE_MS
  );
}

export function reminderScheduledFor(start: Date, type: TimedReminderType): Date {
  return new Date(start.getTime() - REMINDER_OFFSET_MINUTES[type] * MINUTE_MS);
}

/** يوم الجزائر (منتصف الليل UTC، بنفس صيغة عمود date) الذي تقع فيه لحظة معيّنة. */
export function algeriaDayOf(instant: Date): Date {
  const shifted = new Date(instant.getTime() + ALGERIA_OFFSET_MINUTES * MINUTE_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

export type ReminderDecision = "DUE" | "NOT_YET" | "EXPIRED" | "SUPERSEDED";

/**
 * دالة نقية: هل حان وقت هذا التذكير الآن؟
 *  - NOT_YET: لم يحن بعد.
 *  - EXPIRED: بدأ الموعد (أو فات) — لا فائدة من تذكير متأخر.
 *  - SUPERSEDED: تذكير الساعة لم يُرسل قبل أن نصل إلى نافذة الخمس دقائق (حجز متأخر أو خادم كان نائمًا)
 *    فنكتفي بتذكير الخمس دقائق بدل إرسال إشعارين متتاليين.
 *  - DUE: يُرسل الآن.
 */
export function evaluateReminder(type: TimedReminderType, start: Date, now: Date): ReminderDecision {
  if (now.getTime() >= start.getTime()) return "EXPIRED";
  if (now.getTime() < reminderScheduledFor(start, type).getTime()) return "NOT_YET";
  if (type === ReminderType.ONE_HOUR && now.getTime() >= reminderScheduledFor(start, ReminderType.FIVE_MINUTES).getTime()) {
    return "SUPERSEDED";
  }
  return "DUE";
}

/**
 * نص الإشعار — اسم الطبيب والوقت فقط. لا تخصص ولا سبب زيارة ولا ملاحظات ولا أي معلومة طبية،
 * لأن الإشعار يظهر على شاشة القفل ويراه أي شخص قريب من الهاتف.
 */
export function buildReminderPayload(
  type: TimedReminderType,
  appt: { id: string; date: Date; startTime: string; doctor: { firstName: string; lastName: string } },
  now: Date
): PushPayload {
  const doctorName = `د. ${appt.doctor.firstName} ${appt.doctor.lastName}`.trim();
  const url = `/account?appointment=${appt.id}`;
  // وسم الموعد الموحّد: تذكير الخمس دقائق يستبدل تذكير الساعة (وأي إشعار سابق لنفس الموعد) على الهاتف.
  const tag = appointmentNotificationTag(appt.id);
  // حقول الانتهاء: خدمة الدفع لا تسلّمه بعد نهاية يوم الموعد (TTL)، والـService Worker يُغلقه بعدها.
  const expiry = {
    appointmentId: appt.id,
    appointmentDate: appt.date.toISOString().slice(0, 10),
    expiresAt: appointmentDayEndsAt(appt.date).toISOString(),
  };

  if (type === ReminderType.FIVE_MINUTES) {
    // تنبيه بنمط منبّه (انظر sw.js: اهتزاز مميّز + يبقى ظاهرًا حتى يتفاعل المريض + رنة داخل التطبيق إن كان مفتوحًا).
    // يُسلَّم فقط قبل بداية الموعد (deliverBy) وبأولوية عالية لخدمة الدفع.
    return {
      title: FIVE_MINUTE_REMINDER_TITLE,
      body: `لديك موعد مع ${doctorName} على الساعة ${appt.startTime}.`,
      url,
      tag,
      ...expiry,
      kind: FIVE_MINUTE_ALARM_KIND,
      deliverBy: appointmentStartUtc(appt.date, appt.startTime).toISOString(),
      urgency: "high",
    };
  }

  // موعد 00:30 يُذكَّر به على 23:30 من اليوم السابق: "غدًا" لا "اليوم".
  const sameDay = algeriaDayOf(now).getTime() === appt.date.getTime();
  return {
    title: "🔔 تذكير بموعدك",
    body: `لديك موعد مع ${doctorName} ${sameDay ? "اليوم" : "غدًا"} على الساعة ${appt.startTime}.`,
    url,
    tag,
    ...expiry,
    // لا تعارض مع تنبيه الخمس دقائق: تذكير الساعة الذي تأخّر تسليمه (هاتف غير متصل) يُسقط عند بداية
    // نافذة الخمس دقائق، فلا يصل بعد التنبيه ويستبدله على الشاشة (نفس وسم الموعد).
    deliverBy: reminderScheduledFor(appointmentStartUtc(appt.date, appt.startTime), ReminderType.FIVE_MINUTES).toISOString(),
  };
}

export interface ReminderRunStats {
  created: number;
  sent: number;
  skipped: number;
  failed: number;
  /** منها: تنبيهات «دورك اقترب» المرسلة في هذه الدورة. */
  queueApproachSent?: number;
}

/** ينشئ سجلات التذكير (PENDING) للمواعيد المرتبطة بحساب مريض والتي تبدأ قريبًا. آمن للتكرار. */
export async function ensureReminderRows(now: Date): Promise<number> {
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS);
  const appointments = await prisma.appointment.findMany({
    where: {
      patientId: { not: null },
      status: { in: ROW_CREATION_STATUSES },
      date: { gte: algeriaDayOf(now), lte: algeriaDayOf(horizon) },
    },
    select: { id: true, date: true, startTime: true },
    take: 2000,
  });

  const rows: { appointmentId: string; type: ReminderType; scheduledFor: Date }[] = [];
  for (const a of appointments) {
    const start = appointmentStartUtc(a.date, a.startTime);
    if (start.getTime() <= now.getTime() || start.getTime() > horizon.getTime()) continue;
    for (const type of REMINDER_TYPES) {
      rows.push({ appointmentId: a.id, type, scheduledFor: reminderScheduledFor(start, type) });
    }
  }
  if (rows.length === 0) return 0;

  // skipDuplicates يعتمد على القيد الفريد (appointmentId, type): التكرار لا ينشئ سجلًا ثانيًا أبدًا.
  const result = await prisma.appointmentReminder.createMany({ data: rows, skipDuplicates: true });

  // تغيّر وقت الموعد بعد إنشاء سجله (مثلًا من 16:00 إلى 15:30): نصحّح موعد التذكير المعلّق على الوقت
  // الحالي في قاعدة البيانات، فلا يُرسل على الوقت القديم ولا يفوت قبل الوقت الجديد.
  const pending = await prisma.appointmentReminder.findMany({
    where: { appointmentId: { in: rows.map((r) => r.appointmentId) }, status: ReminderStatus.PENDING, type: { in: REMINDER_TYPES } },
    select: { id: true, appointmentId: true, type: true, scheduledFor: true },
  });
  const wanted = new Map(rows.map((r) => [`${r.appointmentId}:${r.type}`, r.scheduledFor.getTime()]));
  for (const p of pending) {
    const at = wanted.get(`${p.appointmentId}:${p.type}`);
    if (at !== undefined && at !== p.scheduledFor.getTime()) {
      await prisma.appointmentReminder.updateMany({
        where: { id: p.id, status: ReminderStatus.PENDING },
        data: { scheduledFor: new Date(at) },
      });
    }
  }
  return result.count;
}

/** هل أُرسل تنبيه «دورك اقترب» لهذا الموعد؟ (ومتى) */
async function queueApproachSentAt(appointmentId: string): Promise<Date | null> {
  const row = await prisma.appointmentReminder.findUnique({
    where: { appointmentId_type: { appointmentId, type: ReminderType.QUEUE_APPROACH } },
    select: { status: true, sentAt: true },
  });
  return row?.status === ReminderStatus.SENT ? row.sentAt ?? new Date(0) : null;
}

async function finish(id: string, status: ReminderStatus, extra: { sentAt?: Date; deliveredCount?: number; skipReason?: string } = {}) {
  await prisma.appointmentReminder.update({ where: { id }, data: { status, ...extra } });
}

/** يعالج التذكيرات التي حان وقتها. كل سجل يُحجز ذرّيًا قبل أي إرسال. */
export async function processDueReminders(now: Date, stats: ReminderRunStats): Promise<void> {
  const due = await prisma.appointmentReminder.findMany({
    where: { status: ReminderStatus.PENDING, scheduledFor: { lte: now }, type: { in: REMINDER_TYPES } },
    orderBy: { scheduledFor: "asc" },
    take: BATCH_SIZE,
    select: { id: true, type: true },
  });

  for (const r of due) {
    // الحجز الذرّي: من يغيّر PENDING → PROCESSING أولًا هو وحده من يرسل.
    const claim = await prisma.appointmentReminder.updateMany({
      where: { id: r.id, status: ReminderStatus.PENDING },
      data: { status: ReminderStatus.PROCESSING },
    });
    if (claim.count !== 1) continue;

    try {
      // قراءة حالة الموعد الآن (بعد الحجز) وليس من وقت إنشاء السجل.
      const reminder = await prisma.appointmentReminder.findUnique({
        where: { id: r.id },
        select: {
          id: true,
          type: true,
          appointment: {
            select: {
              id: true,
              status: true,
              date: true,
              startTime: true,
              doctorId: true,
              patient: { select: { userId: true } },
              doctor: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });
      const appt = reminder?.appointment;
      if (!reminder || !appt) {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: "appointment_missing" });
        stats.skipped += 1;
        continue;
      }
      if (!appt.patient) {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: "no_patient_account" });
        stats.skipped += 1;
        continue;
      }
      const type = reminder.type as TimedReminderType;
      const allowed = type === ReminderType.FIVE_MINUTES ? WAITING_QUEUE_STATUSES : REMINDABLE_STATUSES;
      if (!allowed.includes(appt.status)) {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: `status_${appt.status}` });
        stats.skipped += 1;
        continue;
      }

      const start = appointmentStartUtc(appt.date, appt.startTime);
      const decision = evaluateReminder(type, start, now);
      if (decision === "NOT_YET") {
        // وقت الموعد تغيّر بعد إنشاء السجل: نعيده للانتظار بالوقت الصحيح بدل إرساله مبكرًا.
        await prisma.appointmentReminder.update({
          where: { id: r.id },
          data: { status: ReminderStatus.PENDING, scheduledFor: reminderScheduledFor(start, type) },
        });
        continue;
      }
      if (decision !== "DUE") {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: decision.toLowerCase() });
        stats.skipped += 1;
        continue;
      }

      if (type === ReminderType.FIVE_MINUTES) {
        // تحقق من الطابور الفعلي في قاعدة البيانات لحظة الإرسال: نفس الطبيب، يوم اليوم، قبل الإغلاق،
        // وضمن المنتظرين (CONFIRMED/LATE) بترتيب المناداة الحالي. تغيّر الترتيب بسبب LATE لا يُلغي التذكير.
        const queue = await loadDoctorDayQueue(prisma, appt.doctorId, now);
        if (!locateInQueue(queue.rows, appt.id).waiting) {
          await finish(r.id, ReminderStatus.SKIPPED, { skipReason: "not_in_queue" });
          stats.skipped += 1;
          continue;
        }
      }

      // لا تكرار ولا تضارب مع «دورك اقترب»: إن وصله تنبيه الاقتراب (وهو أدق لأنه من الطابور الفعلي)
      // فلا حاجة لتذكير الساعة ولا لتنبيه الخمس دقائق بعده.
      if (await queueApproachSentAt(appt.id)) {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: "superseded_by_queue_approach" });
        stats.skipped += 1;
        continue;
      }

      if (!isPushEnabled()) {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: "push_disabled" });
        stats.skipped += 1;
        continue;
      }
      const devices = await prisma.pushSubscription.count({ where: { userId: appt.patient.userId } });
      if (devices === 0) {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: "no_subscription" });
        stats.skipped += 1;
        continue;
      }

      const result = await sendPushToUser(appt.patient.userId, buildReminderPayload(type, appt, now), { now });
      if (result.sent > 0) {
        await finish(r.id, ReminderStatus.SENT, { sentAt: now, deliveredCount: result.sent });
        stats.sent += 1;
      } else {
        await finish(r.id, ReminderStatus.FAILED, { skipReason: "delivery_failed" });
        stats.failed += 1;
      }
    } catch (err) {
      console.error("تعذّر معالجة تذكير موعد:", (err as Error)?.message);
      await finish(r.id, ReminderStatus.FAILED, { skipReason: "error" }).catch(() => undefined);
      stats.failed += 1;
    }
  }
}


// ===== «دورك اقترب» — تنبيه مبني على الطابور الفعلي لا على وقت الموعد وحده =====
//
// المنطق (كل دورة، من قاعدة البيانات مباشرة):
//  1) لكل طبيب لديه اليوم مريض صاحب حساب منتظر (CONFIRMED/LATE): نقرأ طابور يومه (loadDoctorDayQueue).
//  2) موقع المريض الحقيقي بترتيب المناداة الفعلي (projectQueueOrder — بما فيه تراجع LATE).
//  3) الوقت المتوقع لدوره = ما تبقّى للمريض الموجود بالداخل + المنتظرون قبله × المدة الذكية
//     (estimateSessionMinutes: متوسط آخر الجلسات الحقيقية للطبيب) — estimateMinutesUntilTurn.
//  4) إن كان ≤ QUEUE_APPROACH_ETA_MINUTES والعيادة تعمل فعلًا الآن → تنبيه واحد فقط لهذا الموعد
//     حتى لو لم يحن وقته الأصلي بعد (أو فات وقته والطبيب متأخر).
// لا يُرسل لمجرد عدد ثابت من المرضى قبله: العدد يدخل فقط عبر الوقت المتوقع.
// IN_PROGRESS/COMPLETED/CANCELLED/NO_SHOW/PENDING ليست «منتظرة» → لا تنبيه.

/** يُرسل التنبيه حين يُتوقَّع أن يُنادى المريض خلال هذه المدة (دقائق). */
export const QUEUE_APPROACH_ETA_MINUTES = 10;
/** العيادة «تعمل» الآن: مريض بالداخل، أو مناداة/إنهاء جلسة خلال هذه المدة. لا تنبيه قبل أن يبدأ الطبيب. */
export const CLINIC_ACTIVE_WINDOW_MINUTES = 30;
/** حدّ أمان: لا تنبيه اقتراب قبل الوقت الأصلي للموعد بأكثر من هذا (دقائق). */
export const QUEUE_APPROACH_MAX_LEAD_MINUTES = 90;
/** إن وصله تنبيه الخمس دقائق للتو، لا ننبّهه مرة ثانية بنمط المنبّه قبل مرور هذه المدة (دقائق). */
export const QUEUE_APPROACH_MIN_GAP_AFTER_5MIN = 10;
/** مدة صلاحية تسليم تنبيه الاقتراب لدى خدمة الدفع (دقائق) — بعدها لا معنى له. */
const QUEUE_APPROACH_DELIVERY_MINUTES = 10;

export type QueueApproachDecision =
  | { send: true; etaMinutes: number }
  | { send: false; reason: "not_waiting" | "clinic_idle" | "too_far" | "too_early" | "recent_5min_alarm" };

/** دالة نقية: هل يُرسل «دورك اقترب» الآن؟ */
export function evaluateQueueApproach(input: {
  queue: Pick<DoctorDayQueue, "rows" | "lastActivityAt">;
  appointmentId: string;
  start: Date;
  sessionMinutes: number;
  now: Date;
  fiveMinuteSentAt?: Date | null;
}): QueueApproachDecision {
  const { queue, appointmentId, start, sessionMinutes, now } = input;
  const pos = locateInQueue(queue.rows, appointmentId);
  const eta = estimateMinutesUntilTurn(pos, sessionMinutes, now);
  if (eta === null) return { send: false, reason: "not_waiting" };
  const recentlyActive =
    queue.lastActivityAt !== null && now.getTime() - queue.lastActivityAt.getTime() <= CLINIC_ACTIVE_WINDOW_MINUTES * MINUTE_MS;
  if (!pos.insideOther && !recentlyActive) return { send: false, reason: "clinic_idle" };
  if (eta > QUEUE_APPROACH_ETA_MINUTES) return { send: false, reason: "too_far" };
  if (now.getTime() < start.getTime() - QUEUE_APPROACH_MAX_LEAD_MINUTES * MINUTE_MS) return { send: false, reason: "too_early" };
  if (input.fiveMinuteSentAt && now.getTime() - input.fiveMinuteSentAt.getTime() < QUEUE_APPROACH_MIN_GAP_AFTER_5MIN * MINUTE_MS) {
    return { send: false, reason: "recent_5min_alarm" };
  }
  return { send: true, etaMinutes: eta };
}

export function buildQueueApproachPayload(appt: { id: string; date: Date }, now: Date): PushPayload {
  return {
    title: QUEUE_APPROACH_TITLE,
    body: QUEUE_APPROACH_BODY,
    url: `/status/${appt.id}`,
    tag: appointmentNotificationTag(appt.id),
    appointmentId: appt.id,
    appointmentDate: appt.date.toISOString().slice(0, 10),
    expiresAt: appointmentDayEndsAt(appt.date).toISOString(),
    kind: QUEUE_APPROACH_ALARM_KIND,
    deliverBy: new Date(now.getTime() + QUEUE_APPROACH_DELIVERY_MINUTES * MINUTE_MS).toISOString(),
    urgency: "high",
  };
}

async function fiveMinuteSentAt(appointmentId: string): Promise<Date | null> {
  const row = await prisma.appointmentReminder.findUnique({
    where: { appointmentId_type: { appointmentId, type: ReminderType.FIVE_MINUTES } },
    select: { status: true, sentAt: true },
  });
  return row?.status === ReminderStatus.SENT ? row.sentAt : null;
}

/** يقيّم ويرسل تنبيهات «دورك اقترب». آمن للتكرار والتزامن (سجل واحد لكل موعد + حجز ذرّي). */
export async function processQueueApproach(now: Date, stats: ReminderRunStats): Promise<void> {
  const day = algeriaDayOf(now);
  const candidates = await prisma.appointment.findMany({
    where: { patientId: { not: null }, date: day, status: { in: WAITING_QUEUE_STATUSES } },
    select: { id: true, doctorId: true },
    take: 2000,
  });
  if (candidates.length === 0) return;

  // لا نعيد تقييم من حُسم تنبيهه (أُرسل أو تُخطّي نهائيًا).
  const done = new Set(
    (
      await prisma.appointmentReminder.findMany({
        where: {
          appointmentId: { in: candidates.map((c) => c.id) },
          type: ReminderType.QUEUE_APPROACH,
          status: { in: [ReminderStatus.SENT, ReminderStatus.SKIPPED, ReminderStatus.FAILED, ReminderStatus.PROCESSING] },
        },
        select: { appointmentId: true },
      })
    ).map((r) => r.appointmentId)
  );
  const byDoctor = new Map<string, string[]>();
  for (const c of candidates) {
    if (done.has(c.id)) continue;
    byDoctor.set(c.doctorId, [...(byDoctor.get(c.doctorId) ?? []), c.id]);
  }

  for (const [doctorId, apptIds] of byDoctor) {
    try {
      const sessionMinutes = await estimateSessionMinutes(doctorId);
      const queue = await loadDoctorDayQueue(prisma, doctorId, now);
      for (const appointmentId of apptIds) {
        await tryQueueApproach(appointmentId, doctorId, sessionMinutes, queue, now, stats);
      }
    } catch (err) {
      console.error("تعذّر تقييم تنبيه «دورك اقترب»:", (err as Error)?.message);
    }
  }
}

async function tryQueueApproach(
  appointmentId: string,
  doctorId: string,
  sessionMinutes: number,
  queue: DoctorDayQueue,
  now: Date,
  stats: ReminderRunStats
): Promise<void> {
  const appt0 = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { date: true, startTime: true } });
  if (!appt0) return;
  const pre = evaluateQueueApproach({
    queue,
    appointmentId,
    start: appointmentStartUtc(appt0.date, appt0.startTime),
    sessionMinutes,
    now,
    fiveMinuteSentAt: await fiveMinuteSentAt(appointmentId),
  });
  if (!pre.send) return;

  // سجل واحد لكل (موعد + QUEUE_APPROACH) ثم حجز ذرّي PENDING → PROCESSING: مُشغِّل واحد فقط يرسل.
  await prisma.appointmentReminder.createMany({
    data: [{ appointmentId, type: ReminderType.QUEUE_APPROACH, scheduledFor: now }],
    skipDuplicates: true,
  });
  const claim = await prisma.appointmentReminder.updateMany({
    where: { appointmentId, type: ReminderType.QUEUE_APPROACH, status: ReminderStatus.PENDING },
    data: { status: ReminderStatus.PROCESSING, scheduledFor: now },
  });
  if (claim.count !== 1) return;

  const finishApproach = (status: ReminderStatus, extra: { sentAt?: Date; deliveredCount?: number; skipReason?: string } = {}) =>
    prisma.appointmentReminder.updateMany({
      where: { appointmentId, type: ReminderType.QUEUE_APPROACH },
      data: { status, ...extra },
    });

  try {
    // بعد الحجز: إعادة القراءة من قاعدة البيانات (الموعد + الطابور) — لا نعتمد على ما قُرئ قبل لحظات.
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, date: true, startTime: true, doctorId: true, status: true, patient: { select: { userId: true } } },
    });
    if (!appt || appt.doctorId !== doctorId || !appt.patient) {
      await finishApproach(ReminderStatus.SKIPPED, { skipReason: "appointment_changed" });
      stats.skipped += 1;
      return;
    }
    if (!WAITING_QUEUE_STATUSES.includes(appt.status)) {
      // IN_PROGRESS أو حُسم (COMPLETED/CANCELLED/NO_SHOW): لا تنبيهات انتظار بعد الآن.
      await finishApproach(ReminderStatus.SKIPPED, { skipReason: `status_${appt.status}` });
      stats.skipped += 1;
      return;
    }
    const fresh = await loadDoctorDayQueue(prisma, doctorId, now);
    const decision = evaluateQueueApproach({
      queue: fresh,
      appointmentId,
      start: appointmentStartUtc(appt.date, appt.startTime),
      sessionMinutes,
      now,
      fiveMinuteSentAt: await fiveMinuteSentAt(appointmentId),
    });
    if (!decision.send) {
      // لم يعد قريبًا (تغيّر الطابور بين القراءتين): نعيده للانتظار دون إرسال، ويُقيَّم في الدورة التالية.
      await finishApproach(ReminderStatus.PENDING);
      return;
    }
    if (!isPushEnabled()) {
      await finishApproach(ReminderStatus.SKIPPED, { skipReason: "push_disabled" });
      stats.skipped += 1;
      return;
    }
    const devices = await prisma.pushSubscription.count({ where: { userId: appt.patient.userId } });
    if (devices === 0) {
      await finishApproach(ReminderStatus.SKIPPED, { skipReason: "no_subscription" });
      stats.skipped += 1;
      return;
    }
    const result = await sendPushToUser(appt.patient.userId, buildQueueApproachPayload(appt, now), { now });
    if (result.sent > 0) {
      await finishApproach(ReminderStatus.SENT, { sentAt: now, deliveredCount: result.sent });
      stats.sent += 1;
      stats.queueApproachSent = (stats.queueApproachSent ?? 0) + 1;
    } else {
      await finishApproach(ReminderStatus.FAILED, { skipReason: "delivery_failed" });
      stats.failed += 1;
    }
  } catch (err) {
    console.error("تعذّر إرسال تنبيه «دورك اقترب»:", (err as Error)?.message);
    await finishApproach(ReminderStatus.FAILED, { skipReason: "error" }).catch(() => undefined);
    stats.failed += 1;
  }
}

// حاجز داخل العملية نفسها: لا تشغيلان متداخلان من setInterval إن طالت دورة سابقة.
// (الحماية بين نسخ الخادم المختلفة يوفّرها الحجز الذرّي في قاعدة البيانات أعلاه.)
let running = false;

export async function runReminderCycle(now: Date = new Date()): Promise<ReminderRunStats & { busy?: boolean }> {
  const stats: ReminderRunStats = { created: 0, sent: 0, skipped: 0, failed: 0 };
  if (running) return { ...stats, busy: true };
  running = true;
  try {
    stats.created = await ensureReminderRows(now);
    // «دورك اقترب» أولًا: إن استحق التنبيهان معًا فالمبني على الطابور الفعلي أدق، وتذكير الخمس دقائق يُتخطّى بعده.
    await processQueueApproach(now, stats);
    await processDueReminders(now, stats);
    return stats;
  } finally {
    running = false;
  }
}
