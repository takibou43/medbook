import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * ترحيل البيانات القديمة: يعلّم isFollowUp = true للمواعيد التي يمكن إثبات أنها «موعد عودة برمجه الطبيب» فقط:
 * مرتبطة بموعد أصلي (parentAppointmentId)، أنشأها الطبيب (createdBy = DOCTOR)، ونوعها FOLLOW_UP — وهو الشكل
 * الذي يكتبه createFollowUpAppointment حرفيًا. لا يغيّر وقتًا ولا حالة ولا أي عمود آخر، ولا يمسّ من هو false
 * وغير مطابق. آمن للتكرار عند كل إقلاع (نفس نمط grandfatherExistingDoctors). يعيد عدد الصفوف التي عُلِّمت.
 */
export async function backfillFollowUpFlag(db: PrismaClient | Prisma.TransactionClient): Promise<number> {
  const result = await db.appointment.updateMany({
    where: { isFollowUp: false, parentAppointmentId: { not: null }, createdBy: "DOCTOR", type: "FOLLOW_UP" },
    data: { isFollowUp: true },
  });
  return result.count;
}
