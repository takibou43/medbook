import { prisma } from "../../lib/prisma";

export type NotificationType =
  | "APPOINTMENT_CREATED"
  | "APPOINTMENT_CONFIRMED"
  | "APPOINTMENT_CANCELLED"
  | "APPOINTMENT_COMPLETED"
  | "APPOINTMENT_NO_SHOW"
  | "APPOINTMENT_REMINDER"
  | "DOCTOR_VERIFIED"
  | "DOCTOR_REJECTED";

/**
 * إنشاء إشعار داخل التطبيق (In-App).
 * الـ Architecture مصممة لتُستبدل لاحقًا بمزوّدات خارجية (Email/SMS/WhatsApp/Push)
 * عبر إضافة "channel adapters" هنا دون تغيير بقية النظام الذي يستدعي createNotification فقط.
 */
export async function createNotification(userId: string, type: NotificationType, title: string, message: string) {
  return prisma.notification.create({ data: { userId, type, title, message } });
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
