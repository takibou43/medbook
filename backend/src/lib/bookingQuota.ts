import { AppointmentStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "../utils/ApiError";
import { algeriaTodayUTCMidnight } from "./slots";

/**
 * سقوف حماية جدول المواعيد من الإغراق (حجز بالجملة أو حجز/إلغاء متكرر).
 * القيم سخية بما يكفي للاستعمال الحقيقي (مريض يحجز لأفراد عائلته) لكنها تقطع الإساءة الآلية.
 * تُفحص من جهة الخادم على patientId القادم من الجلسة، لا من جسم الطلب.
 */
export const MAX_ACTIVE_APPOINTMENTS_PER_PATIENT = 6;
export const MAX_ACTIVE_PER_PATIENT_PER_DOCTOR = 3;
export const MAX_CREATED_PER_PATIENT_PER_24H = 10;
export const MAX_CREATED_PER_PATIENT_PER_30D = 30;

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.RESCHEDULE_REQUIRED,
  AppointmentStatus.LATE,
  AppointmentStatus.IN_PROGRESS,
];

export const BOOKING_QUOTA_MESSAGES = {
  active: "لديك عدد كبير من المواعيد النشطة. ألغِ موعدًا لا تحتاجه أو انتظر حتى يمرّ أحدها قبل حجز موعد جديد.",
  perDoctor: "لديك بالفعل عدة مواعيد نشطة لدى هذا الطبيب. لا يمكن حجز المزيد قبل أن يمرّ أحدها أو يُلغى.",
  daily: "بلغت الحد الأقصى لعدد الحجوزات خلال 24 ساعة. يرجى المحاولة لاحقًا.",
  monthly: "بلغت الحد الأقصى لعدد الحجوزات خلال 30 يومًا. يرجى التواصل مع الدعم إن كنت بحاجة لمزيد.",
} as const;

/** يرمي 429 إن تجاوز المريض أحد السقوف. يُستدعى قبل إنشاء أي موعد. */
export async function assertBookingQuota(patientId: string, doctorId?: string | null): Promise<void> {
  const today = algeriaTodayUTCMidnight();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [active, activeWithDoctor, createdRecently, createdMonth] = await Promise.all([
    prisma.appointment.count({ where: { patientId, status: { in: ACTIVE_STATUSES }, date: { gte: today } } }),
    doctorId ? prisma.appointment.count({ where: { patientId, doctorId, status: { in: ACTIVE_STATUSES }, date: { gte: today } } }) : Promise.resolve(0),
    // يشمل الملغاة عمدًا: يقطع حلقة «احجز ثم ألغِ» المتكررة التي تملأ الجدول.
    prisma.appointment.count({ where: { patientId, createdAt: { gte: since } } }),
    prisma.appointment.count({ where: { patientId, createdAt: { gte: since30d } } }),
  ]);

  if (active >= MAX_ACTIVE_APPOINTMENTS_PER_PATIENT) throw new ApiError(429, BOOKING_QUOTA_MESSAGES.active);
  if (activeWithDoctor >= MAX_ACTIVE_PER_PATIENT_PER_DOCTOR) throw new ApiError(429, BOOKING_QUOTA_MESSAGES.perDoctor);
  if (createdRecently >= MAX_CREATED_PER_PATIENT_PER_24H) throw new ApiError(429, BOOKING_QUOTA_MESSAGES.daily);
  if (createdMonth >= MAX_CREATED_PER_PATIENT_PER_30D) throw new ApiError(429, BOOKING_QUOTA_MESSAGES.monthly);
}
