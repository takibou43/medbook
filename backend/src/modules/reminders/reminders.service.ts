import { AppointmentStatus, ReminderStatus, ReminderType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { sendPushToUser, isPushEnabled, PushPayload } from "../../lib/push";
import { ALGERIA_OFFSET_MINUTES } from "../../lib/slots";

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

export const REMINDER_OFFSET_MINUTES: Record<ReminderType, number> = {
  ONE_HOUR: 60,
  FIVE_MINUTES: 5,
};

export const REMINDER_TYPES: ReminderType[] = [ReminderType.ONE_HOUR, ReminderType.FIVE_MINUTES];

// التذكير فقط للمواعيد القادمة التي لم تُحسم بعد. LATE/IN_PROGRESS تعني أن المريض في العيادة أصلًا،
// و COMPLETED/CANCELLED/NO_SHOW انتهت — لا تذكير لأي منها.
export const REMINDABLE_STATUSES: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];

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

export function reminderScheduledFor(start: Date, type: ReminderType): Date {
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
export function evaluateReminder(type: ReminderType, start: Date, now: Date): ReminderDecision {
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
  type: ReminderType,
  appt: { id: string; date: Date; startTime: string; doctor: { firstName: string; lastName: string } },
  now: Date
): PushPayload {
  const doctorName = `د. ${appt.doctor.firstName} ${appt.doctor.lastName}`.trim();
  const url = `/account?appointment=${appt.id}`;
  const tag = `reminder-${appt.id}-${type}`;

  if (type === ReminderType.FIVE_MINUTES) {
    return {
      title: "🔔 موعدك بعد 5 دقائق",
      body: `لديك موعد مع ${doctorName} على الساعة ${appt.startTime}.`,
      url,
      tag,
    };
  }

  // موعد 00:30 يُذكَّر به على 23:30 من اليوم السابق: "غدًا" لا "اليوم".
  const sameDay = algeriaDayOf(now).getTime() === appt.date.getTime();
  return {
    title: "🔔 تذكير بموعدك",
    body: `لديك موعد مع ${doctorName} ${sameDay ? "اليوم" : "غدًا"} على الساعة ${appt.startTime}.`,
    url,
    tag,
  };
}

export interface ReminderRunStats {
  created: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** ينشئ سجلات التذكير (PENDING) للمواعيد المرتبطة بحساب مريض والتي تبدأ قريبًا. آمن للتكرار. */
export async function ensureReminderRows(now: Date): Promise<number> {
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS);
  const appointments = await prisma.appointment.findMany({
    where: {
      patientId: { not: null },
      status: { in: REMINDABLE_STATUSES },
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
  return result.count;
}

async function finish(id: string, status: ReminderStatus, extra: { sentAt?: Date; deliveredCount?: number; skipReason?: string } = {}) {
  await prisma.appointmentReminder.update({ where: { id }, data: { status, ...extra } });
}

/** يعالج التذكيرات التي حان وقتها. كل سجل يُحجز ذرّيًا قبل أي إرسال. */
export async function processDueReminders(now: Date, stats: ReminderRunStats): Promise<void> {
  const due = await prisma.appointmentReminder.findMany({
    where: { status: ReminderStatus.PENDING, scheduledFor: { lte: now } },
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
      if (!REMINDABLE_STATUSES.includes(appt.status)) {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: `status_${appt.status}` });
        stats.skipped += 1;
        continue;
      }

      const start = appointmentStartUtc(appt.date, appt.startTime);
      const decision = evaluateReminder(reminder.type, start, now);
      if (decision === "NOT_YET") {
        // وقت الموعد تغيّر بعد إنشاء السجل: نعيده للانتظار بالوقت الصحيح بدل إرساله مبكرًا.
        await prisma.appointmentReminder.update({
          where: { id: r.id },
          data: { status: ReminderStatus.PENDING, scheduledFor: reminderScheduledFor(start, reminder.type) },
        });
        continue;
      }
      if (decision !== "DUE") {
        await finish(r.id, ReminderStatus.SKIPPED, { skipReason: decision.toLowerCase() });
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

      const result = await sendPushToUser(appt.patient.userId, buildReminderPayload(reminder.type, appt, now));
      if (result.sent > 0) {
        await finish(r.id, ReminderStatus.SENT, { sentAt: new Date(), deliveredCount: result.sent });
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

// حاجز داخل العملية نفسها: لا تشغيلان متداخلان من setInterval إن طالت دورة سابقة.
// (الحماية بين نسخ الخادم المختلفة يوفّرها الحجز الذرّي في قاعدة البيانات أعلاه.)
let running = false;

export async function runReminderCycle(now: Date = new Date()): Promise<ReminderRunStats & { busy?: boolean }> {
  const stats: ReminderRunStats = { created: 0, sent: 0, skipped: 0, failed: 0 };
  if (running) return { ...stats, busy: true };
  running = true;
  try {
    stats.created = await ensureReminderRows(now);
    await processDueReminders(now, stats);
    return stats;
  } finally {
    running = false;
  }
}
