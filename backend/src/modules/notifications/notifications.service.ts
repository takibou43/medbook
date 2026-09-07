import { prisma } from "../../lib/prisma";
import { sendPushToUser } from "../../lib/push";

export type NotificationType =
  | "APPOINTMENT_CREATED"
  | "APPOINTMENT_CONFIRMED"
  | "APPOINTMENT_CANCELLED"
  | "APPOINTMENT_COMPLETED"
  | "APPOINTMENT_NO_SHOW"
  | "APPOINTMENT_REMINDER"
  | "DOCTOR_VERIFIED"
  | "DOCTOR_REJECTED";

// نص محايد لإشعار المتصفح حسب نوع الحدث. متعمّد أن يخلو من اسم المريض ورقمه:
// الإشعار يظهر على شاشة القفل وقد يراه من بجانب الطبيب في العيادة، والتفاصيل تبقى داخل اللوحة.
const PUSH_BODY: Partial<Record<NotificationType, string>> = {
  APPOINTMENT_CREATED: "لديك حجز جديد. افتح اللوحة لعرض التفاصيل.",
  APPOINTMENT_CANCELLED: "تم إلغاء أحد المواعيد. افتح اللوحة لعرض التفاصيل.",
  APPOINTMENT_CONFIRMED: "تم تأكيد موعد. افتح التطبيق لعرض التفاصيل.",
  APPOINTMENT_REMINDER: "تذكير بموعد قريب. افتح التطبيق لعرض التفاصيل.",
};

/**
 * إنشاء إشعار داخل التطبيق (In-App)، ومعه إشعار متصفح (Web Push) لمن فعّله على جهازه.
 *
 * إرسال الـPush متعمدٌ بلا await: هو قناة مساعدة لا يجوز أن تُبطئ الحجز أو تُفشله إن تعطّلت
 * خدمة الدفع لدى المتصفح. وsendPushToUser لا ترمي استثناءً أصلًا، وتعود صفرًا إن كانت الميزة معطّلة.
 */
export async function createNotification(userId: string, type: NotificationType, title: string, message: string) {
  const notification = await prisma.notification.create({ data: { userId, type, title, message } });

  void sendPushToUser(userId, {
    title,
    body: PUSH_BODY[type] ?? "افتح التطبيق لعرض التفاصيل.",
    tag: type,
  });

  return notification;
}

export async function listForUser(userId: string, onlyUnread = false) {
  return prisma.notification.findMany({
    where: { userId, ...(onlyUnread ? { isRead: false } : {}) },
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
