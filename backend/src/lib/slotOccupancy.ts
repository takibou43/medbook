import { AppointmentStatus, Prisma } from "@prisma/client";

/**
 * متى يشغل الموعد وقته؟ كل الحالات عدا CANCELLED:
 * PENDING / CONFIRMED / IN_PROGRESS / LATE (نشطة) و COMPLETED / NO_SHOW (نهائية، سلوكها لم يتغيّر).
 * الموعد الملغى يبقى محفوظًا في قاعدة البيانات للتاريخ والتدقيق، لكنه لا يمنع حجزًا جديدًا في نفس الوقت.
 *
 * هذا الفلتر مطابق حرفيًا لقيد قاعدة البيانات: (doctorId, date, startTime, activeSlot) فريد، و activeSlot
 * يصير NULL عند الإلغاء فقط — فلا يعرض النظام وقتًا على أنه متاح ثم ترفضه قاعدة البيانات، أو العكس.
 */
export const SLOT_OCCUPYING_WHERE: Prisma.AppointmentWhereInput = {
  status: { not: AppointmentStatus.CANCELLED },
};

/** يُدمج في data عند أي تحويل إلى CANCELLED: يحرّر الوقت (يحرسه أيضًا trigger في قاعدة البيانات). */
export const RELEASE_SLOT_DATA = { activeSlot: null } as const;
