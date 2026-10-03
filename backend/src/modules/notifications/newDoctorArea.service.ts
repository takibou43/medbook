import type { Prisma } from "@prisma/client";
import { sendPushToUser } from "../../lib/push";
import { newDoctorAnnouncement, type AnnouncedDoctor } from "../../lib/newDoctorAnnouncement";

/**
 * يضع إشعارًا عامًا لكل مريض حدّد مدينة داخل ولاية الطبيب. لا نستنتج الموقع من موعد سابق
 * ولا من عنوان IP. القيد الفريد في قاعدة البيانات يمنع التكرار عند إعادة المحاولة.
 */
export async function queueNewDoctorAreaNotifications(tx: Prisma.TransactionClient, doctor: AnnouncedDoctor) {
  const announcement = newDoctorAnnouncement(doctor);
  const cities = await tx.city.findMany({ where: { wilayaId: doctor.wilayaId }, select: { id: true } });
  if (cities.length === 0) return [] as string[];

  const recipients = await tx.patient.findMany({
    where: { cityId: { in: cities.map((city) => city.id) }, user: { isActive: true }, ...(doctor.userId ? { userId: { not: doctor.userId } } : {}) },
    select: { userId: true },
  });
  if (recipients.length === 0) return [] as string[];

  const userIds = recipients.map((patient) => patient.userId);
  const alreadyQueued = await tx.notification.findMany({
    where: { userId: { in: userIds }, type: "NEW_DOCTOR_IN_AREA", newDoctorId: doctor.id },
    select: { userId: true },
  });
  const existing = new Set(alreadyQueued.map((notification) => notification.userId));
  const pendingUserIds = userIds.filter((userId) => !existing.has(userId));
  if (pendingUserIds.length === 0) return [] as string[];

  await tx.notification.createMany({
    data: pendingUserIds.map((userId) => ({
      userId,
      type: "NEW_DOCTOR_IN_AREA",
      newDoctorId: doctor.id,
      title: announcement.title,
      message: announcement.message,
    })),
    skipDuplicates: true,
  });
  return pendingUserIds;
}

export function pushNewDoctorAreaNotification(userIds: string[], doctor: AnnouncedDoctor) {
  const announcement = newDoctorAnnouncement(doctor);
  for (const userId of userIds) {
    void sendPushToUser(userId, {
      title: announcement.title,
      body: announcement.pushBody,
      url: "/",
      tag: `new-doctor-${doctor.id}`,
    });
  }
}

