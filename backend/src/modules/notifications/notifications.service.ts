import { prisma } from "../../lib/prisma";
import { sendPushToUser } from "../../lib/push";
import { appointmentDayEndsAt } from "../../lib/appointmentExpiry";

export type NotificationType =
  | "APPOINTMENT_CREATED"
  | "APPOINTMENT_CONFIRMED"
  | "APPOINTMENT_CANCELLED"
  | "APPOINTMENT_COMPLETED"
  | "APPOINTMENT_NO_SHOW"
  | "APPOINTMENT_REMINDER"
  | "APPOINTMENT_LATE"
  | "DOCTOR_VERIFIED"
  | "DOCTOR_REJECTED"
  | "NEW_MESSAGE";

// نص محايد لإشعار المتصفح حسب نوع الحدث. متعمّد أن يخلو من اسم المريض ورقمه:
// الإشعار يظهر على شاشة القفل وقد يراه من بجانب الطبيب في العيادة، والتفاصيل تبقى داخل اللوحة.
const PUSH_BODY: Partial<Record<NotificationType, string>> = {
  APPOINTMENT_CREATED: "لديك حجز جديد. افتح اللوحة لعرض التفاصيل.",
  APPOINTMENT_CANCELLED: "تم إلغاء أحد المواعيد. افتح اللوحة لعرض التفاصيل.",
  APPOINTMENT_CONFIRMED: "تم تأكيد موعد. افتح التطبيق لعرض التفاصيل.",
  APPOINTMENT_REMINDER: "تذكير بموعد قريب. افتح التطبيق لعرض التفاصيل.",
  NEW_MESSAGE: "لديك رسالة جديدة. افتح قسم الرسائل.",
  // للمريض صاحب الحساب عند تسجيله «متأخر» — بلا أي معلومة طبية.
  APPOINTMENT_LATE: "تم تجاوز دورك مؤقتًا لأنك لم تكن حاضرًا عند المناداة. توجّه إلى العيادة، ما زلت في قائمة الانتظار.",
};

/** الموعد الذي يخصه الإشعار: يكفي معرّفه ويومه (عمود date، منتصف الليل UTC ليوم الجزائر). */
export interface NotificationAppointmentRef {
  id: string;
  date: Date;
}

/**
 * إنشاء إشعار داخل التطبيق (In-App)، ومعه إشعار متصفح (Web Push) لمن فعّله على جهازه.
 *
 * إرسال الـPush متعمدٌ بلا await: هو قناة مساعدة لا يجوز أن تُبطئ الحجز أو تُفشله إن تعطّلت
 * خدمة الدفع لدى المتصفح. وsendPushToUser لا ترمي استثناءً أصلًا، وتعود صفرًا إن كانت الميزة معطّلة.
 *
 * appointment (اختياري): يجعل الإشعار «إشعار موعد» ينتهي بنهاية يوم ذلك الموعد بتوقيت الجزائر —
 * يُخفى بعدها من مركز الإشعارات ويُحذف دوريًا، ويحمل الـPush نفس الحقول ليُغلقه الـService Worker.
 * إن كان يوم الموعد قد انتهى أصلًا لا يُنشأ شيء ولا يُرسل أي Push (يُرجَع null).
 */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  url?: string,
  // وسم اختياري فريد للحدث (مثل appt-<appointmentId>) — وإلا نوع الإشعار كما كان.
  tag?: string,
  appointment?: NotificationAppointmentRef,
  now: Date = new Date()
) {
  const expiresAt = appointment ? appointmentDayEndsAt(appointment.date) : null;
  if (expiresAt && now.getTime() >= expiresAt.getTime()) return null;

  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      ...(appointment ? { appointmentId: appointment.id, appointmentDate: appointment.date, expiresAt } : {}),
    },
  });

  void sendPushToUser(userId, {
    title,
    body: PUSH_BODY[type] ?? "افتح التطبيق لعرض التفاصيل.",
    tag: tag ?? type,
    ...(url ? { url } : {}),
    ...(appointment && expiresAt
      ? {
          appointmentId: appointment.id,
          appointmentDate: appointment.date.toISOString().slice(0, 10),
          expiresAt: expiresAt.toISOString(),
        }
      : {}),
  });

  return notification;
}

/** شرط «ما زال صالحًا»: إشعار عام (expiresAt = NULL) أو إشعار موعد لم ينتهِ يومه بعد. */
function notExpired(now: Date) {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

export async function listForUser(userId: string, onlyUnread = false, now: Date = new Date()) {
  return prisma.notification.findMany({
    where: { userId, ...(onlyUnread ? { isRead: false } : {}), ...notExpired(now) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function markAsRead(userId: string, id: string) {
  return prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
}

/**
 * حذف إشعارات المواعيد المنتهية فعليًا من قاعدة البيانات (تُخفى قبل ذلك بفلتر listForUser على أي حال).
 * لا يلمس أي إشعار عام: الشرط expiresAt <= now لا يطابق NULL أبدًا.
 */
export async function purgeExpiredNotifications(now: Date = new Date()): Promise<number> {
  const r = await prisma.notification.deleteMany({ where: { expiresAt: { lte: now } } });
  return r.count;
}
