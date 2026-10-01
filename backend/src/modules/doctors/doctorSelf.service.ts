import { AppointmentStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { algeriaTodayUTCMidnight } from "../../lib/slots";
import { autoExpireStaleAppointments } from "../appointments/appointments.service";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { isWithinWorkingHours, ScheduleBlock } from "../../lib/slots";
import { createNotification } from "../notifications/notifications.service";

const SCHEDULE_ACTIVE_STATUSES: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];

type AffectedAppointment = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  patient: { userId: string } | null;
};

function conflictDetails(appointments: AffectedAppointment[]) {
  return {
    code: "APPOINTMENTS_REQUIRE_RESCHEDULE",
    affectedCount: appointments.length,
    appointments: appointments.map((a) => ({ id: a.id, date: a.date.toISOString().slice(0, 10), startTime: a.startTime })),
  };
}

async function notifyAffectedAppointments(appointments: AffectedAppointment[], cancelledForDayOff = false) {
  const results = await Promise.allSettled(
    appointments.flatMap((appointment) =>
      appointment.patient
        ? [createNotification(
            appointment.patient.userId,
            cancelledForDayOff ? "APPOINTMENT_CANCELLED" : "APPOINTMENT_RESCHEDULE_REQUIRED",
            cancelledForDayOff ? "أُلغي موعدك بسبب عطلة الطبيب" : "موعدك يحتاج إلى إعادة جدولة",
            cancelledForDayOff
              ? `جعل الطبيب يوم ${appointment.date.toISOString().slice(0, 10)} عطلة، لذلك أُلغي موعدك الساعة ${appointment.startTime}. يرجى حجز موعد جديد يناسبك.`
              : `غيّر الطبيب أوقات عمله وأصبح موعد ${appointment.date.toISOString().slice(0, 10)} الساعة ${appointment.startTime} غير متاح. يرجى اختيار موعد جديد أو انتظار تواصل العيادة.`,
            `/account?appointment=${appointment.id}`,
            `${cancelledForDayOff ? "day-off-cancelled" : "reschedule"}-${appointment.id}`,
            { id: appointment.id, date: appointment.date }
          )]
        : []
    )
  );
  if (results.some((result) => result.status === "rejected")) {
    console.error("تعذّر إنشاء بعض إشعارات إعادة جدولة المواعيد.");
  }
}

// شرط التحويل إلى RESCHEDULE_REQUIRED: نفس المواعيد المتأثرة، وبشرط أن تكون ما تزال نشطة لحظة
// الكتابة. يمنع سباقًا يُلغى فيه الموعد أو يبدأ (IN_PROGRESS/LATE/COMPLETED) بين الفحص والحفظ فيُكتب فوقه.
export function markRescheduleWhere(affected: { id: string }[]) {
  return { id: { in: affected.map((a) => a.id) }, status: { in: SCHEDULE_ACTIVE_STATUSES } };
}

async function findAffectedAppointments(doctorId: string, schedules: ScheduleBlock[]): Promise<AffectedAppointment[]> {
  const appointments = await prisma.appointment.findMany({
    where: { doctorId, date: { gte: algeriaTodayUTCMidnight() }, status: { in: SCHEDULE_ACTIVE_STATUSES } },
    select: { id: true, date: true, startTime: true, endTime: true, patient: { select: { userId: true } } },
  });
  return appointments.filter((appointment) => !isWithinWorkingHours(appointment.date, appointment.startTime, appointment.endTime, schedules));
}

// تُستعمل من الوظائف الخاصة بالطبيب فقط (الملف المهني، أوقات العمل، مرضاي) — هذه المسارات
// محمية أصلًا بـ authorize(Role.DOCTOR) في doctorSelf.routes.ts، فلا حاجة لدعم المساعد هنا.
export async function getDoctorByUserId(userId: string) {
  const doctor = await prisma.doctor.findUnique({ where: { userId } });
  if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
  return doctor;
}

export async function updateOwnProfile(
  userId: string,
  data: Partial<{
    bio: string;
    yearsExperience: number;
    languages: string[];
    consultationFee: number;
    phone: string;
    address: string;
    photoUrl: string;
    clinicId: string;
    specialtyId: string;
    wilayaId: string;
    cityId: string;
    slotDurationMin: number;
    latitude: number;
    longitude: number;
  }>
) {
  const doctor = await getDoctorByUserId(userId);
  if (data.clinicId !== undefined) throw ApiError.forbidden("تغيير العيادة يتطلب دعوة من صاحبها.");
  if (doctor.clinicId && (data.wilayaId !== undefined || data.cityId !== undefined || data.address !== undefined)) {
    const clinic = await prisma.clinic.findUnique({ where: { id: doctor.clinicId } });
    if (clinic?.ownerId && ((data.wilayaId && data.wilayaId !== clinic.wilayaId) || (data.cityId && data.cityId !== clinic.cityId) || (data.address !== undefined && data.address !== clinic.address)))
      throw ApiError.badRequest("موقع طبيب العيادة يتبع موقع العيادة.");
  }
  return prisma.doctor.update({ where: { id: doctor.id }, data });
}

export async function getWeeklySchedule(userId: string) {
  const doctor = await getDoctorByUserId(userId);
  return prisma.doctorSchedule.findMany({ where: { doctorId: doctor.id }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] });
}

export async function replaceWeeklySchedule(
  userId: string,
  blocks: { dayOfWeek: number; startTime: string; endTime: string }[],
  confirmAffected = false
) {
  const doctor = await getDoctorByUserId(userId);
  const exceptions = await prisma.doctorSchedule.findMany({ where: { doctorId: doctor.id, isException: true } });
  const proposed: ScheduleBlock[] = [
    ...exceptions,
    ...blocks.map((block) => ({ ...block, isException: false, exceptionDate: null, isOff: false })),
  ];
  const affected = await findAffectedAppointments(doctor.id, proposed);
  if (affected.length > 0 && !confirmAffected) {
    throw ApiError.conflict("سيؤثر هذا التعديل في مواعيد محجوزة مسبقًا. يلزم تأكيدك قبل الحفظ.", conflictDetails(affected));
  }
  await prisma.$transaction([
    prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id, isException: false } }),
    prisma.doctorSchedule.createMany({
      data: blocks.map((b) => ({ doctorId: doctor.id, dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime })),
    }),
    ...(affected.length > 0
      ? [prisma.appointment.updateMany({ where: markRescheduleWhere(affected), data: { status: AppointmentStatus.RESCHEDULE_REQUIRED } })]
      : []),
  ]);
  await notifyAffectedAppointments(affected);
  return { schedule: await getWeeklySchedule(userId), affectedAppointments: affected.length };
}

export async function addScheduleException(
  userId: string,
  exception: { exceptionDate: string; isOff: boolean; startTime?: string; endTime?: string },
  confirmAffected = false
) {
  const doctor = await getDoctorByUserId(userId);
  const exceptionDate = new Date(exception.exceptionDate + "T00:00:00Z");
  const current = await prisma.doctorSchedule.findMany({ where: { doctorId: doctor.id } });
  const proposed: ScheduleBlock[] = [
    ...current,
    {
      dayOfWeek: null,
      isException: true,
      exceptionDate,
      isOff: exception.isOff,
      startTime: exception.startTime ?? "00:00",
      endTime: exception.endTime ?? "23:59",
    },
  ];
  const affected = (await findAffectedAppointments(doctor.id, proposed)).filter(
    (appointment) => appointment.date.toISOString().slice(0, 10) === exception.exceptionDate
  );
  if (affected.length > 0 && !confirmAffected) {
    throw ApiError.conflict(
      exception.isOff
        ? "يوجد في هذا اليوم مواعيد محجوزة مسبقًا. سيؤدي تأكيد العطلة إلى إلغائها نهائيًا وإشعار المرضى."
        : "سيؤثر هذا التعديل في مواعيد محجوزة مسبقًا. يلزم تأكيدك قبل الحفظ.",
      conflictDetails(affected)
    );
  }
  const affectedStatus = exception.isOff ? AppointmentStatus.CANCELLED : AppointmentStatus.RESCHEDULE_REQUIRED;
  const [created] = await prisma.$transaction([
    prisma.doctorSchedule.create({
      data: {
        doctorId: doctor.id,
        isException: true,
        exceptionDate,
        isOff: exception.isOff,
        startTime: exception.startTime ?? "00:00",
        endTime: exception.endTime ?? "23:59",
      },
    }),
    ...(affected.length > 0
      ? [prisma.appointment.updateMany({ where: markRescheduleWhere(affected), data: { status: affectedStatus } })]
      : []),
  ]);
  await notifyAffectedAppointments(affected, exception.isOff);
  return { schedule: created, affectedAppointments: affected.length };
}

export async function removeScheduleBlock(userId: string, blockId: string) {
  const doctor = await getDoctorByUserId(userId);
  const block = await prisma.doctorSchedule.findUnique({ where: { id: blockId } });
  if (!block || block.doctorId !== doctor.id) throw ApiError.notFound("العنصر غير موجود.");
  await prisma.doctorSchedule.delete({ where: { id: blockId } });
}

/**
 * متاحة للطبيب وللمساعد معًا. تُحسب كل الأرقام كما هي دائمًا، لكن الحقول المالية/الإدارية
 * غير المسموحة للمساعد (الشهري، الإجمالي، سعر الاستشارة، حالة الاشتراك، عدد المرضى،
 * نسبة الغياب) تُحذف بالكامل من الكائن المُرجَع في نهاية الدالة عندما role !== DOCTOR —
 * أي أنها لا تصل إلى الشبكة أصلًا، وليس فقط مخفية في الواجهة.
 */
export async function getDashboardStats(userId: string, role: Role) {
  const doctorId = await resolveActingDoctorId(userId, role);
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
  await autoExpireStaleAppointments(doctor.id);
  const startOfDay = algeriaTodayUTCMidnight();
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCHours(23, 59, 59, 999);
  // بداية الشهر الحالي (بتوقيت التخزين UTC نفسه المستعمل لحقل date) — لإحصائية "مواعيد هذا الشهر".
  const monthStart = new Date(Date.UTC(startOfDay.getUTCFullYear(), startOfDay.getUTCMonth(), 1));
  // آخر لحظة من الشهر الحالي — الدخل الشهري يُحسب على الشهر كاملًا لا حتى اليوم فقط.
  const monthEnd = new Date(Date.UTC(startOfDay.getUTCFullYear(), startOfDay.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const [
    todayCount,
    upcomingCount,
    completedCount,
    cancelledCount,
    noShowCount,
    monthlyCount,
    allForPatientsCount,
    completedTodayCount,
    completedMonthCount,
  ] = await Promise.all([
    prisma.appointment.count({ where: { doctorId: doctor.id, date: { gte: startOfDay, lte: endOfDay } } }),
    prisma.appointment.count({
      where: { doctorId: doctor.id, date: { gt: endOfDay }, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] } },
    }),
    prisma.appointment.count({ where: { doctorId: doctor.id, status: AppointmentStatus.COMPLETED } }),
    prisma.appointment.count({ where: { doctorId: doctor.id, status: AppointmentStatus.CANCELLED } }),
    prisma.appointment.count({ where: { doctorId: doctor.id, status: AppointmentStatus.NO_SHOW } }),
    prisma.appointment.count({ where: { doctorId: doctor.id, date: { gte: monthStart, lte: endOfDay } } }),
    // لا يمكن الاعتماد على distinct:["patientId"] وحده لأن الحجوزات كضيف تحمل patientId فارغًا (null)
    // وستُحسب كلها كـ "مريض واحد" فقط؛ لذا نجلب المعرّفات ونحسب التفرّد يدويًا (مريض حقيقي أو رقم هاتف ضيف).
    prisma.appointment.findMany({ where: { doctorId: doctor.id }, select: { patientId: true, guestPhone: true, id: true } }),
    // الدخل التقديري يُحسب من المواعيد المكتملة (COMPLETED) وحدها — لا من المؤكّدة ولا
    // التي بالداخل الآن ولا الملغاة ولا "لم يحضر". النطاق الزمني بنفس اصطلاح حقل date
    // (تاريخ تقويمي مخزَّن عند 00:00 UTC محسوبًا بتوقيت الجزائر).
    prisma.appointment.count({
      where: { doctorId: doctor.id, status: AppointmentStatus.COMPLETED, date: { gte: startOfDay, lte: endOfDay } },
    }),
    prisma.appointment.count({
      where: { doctorId: doctor.id, status: AppointmentStatus.COMPLETED, date: { gte: monthStart, lte: monthEnd } },
    }),
  ]);

  const uniquePatientKeys = new Set(allForPatientsCount.map((a) => a.patientId ?? `guest:${a.guestPhone ?? a.id}`));

  // نسبة الغياب تُحسب من مجموع المواعيد "المحسومة" (انتهت فعليًا: حضر/ألغى/لم يحضر) فقط،
  // دون المواعيد القادمة التي لم يُحسم أمرها بعد — وإلا كانت النسبة مضلِّلة لطبيب حديث الانضمام.
  const settledCount = completedCount + cancelledCount + noShowCount;
  const noShowRate = settledCount > 0 ? Math.round((noShowCount / settledCount) * 1000) / 10 : 0;

  // تقدير الدخل: عدد المواعيد المكتملة × سعر الاستشارة الحالي للطبيب. تقدير تقريبي فقط
  // (لا يعكس تغييرات سعر الاستشارة عبر الزمن ولا نأخذ به دفعات فعلية — لا بوابة دفع بعد).
  const consultationFee = doctor.consultationFee ?? 0;
  const estimatedRevenue = completedCount * consultationFee;
  const estimatedRevenueToday = completedTodayCount * consultationFee;
  const estimatedRevenueMonth = completedMonthCount * consultationFee;

  const fullStats = {
    todayAppointments: todayCount,
    upcomingAppointments: upcomingCount,
    completedAppointments: completedCount,
    cancelledAppointments: cancelledCount,
    noShowAppointments: noShowCount,
    noShowRate,
    monthlyAppointments: monthlyCount,
    estimatedRevenue,
    estimatedRevenueToday,
    estimatedRevenueMonth,
    completedToday: completedTodayCount,
    completedThisMonth: completedMonthCount,
    consultationFee,
    totalPatients: uniquePatientKeys.size,
    avgRating: doctor.avgRating,
    reviewsCount: doctor.reviewsCount,
    verificationStatus: doctor.verificationStatus,
    // لا واجهة تعرض هذا الحقل بعد على موقع الطبيب — إعداد تقني تمهيدي لميزة اشتراك
    // الدفع القادمة (BaridiMob)، انظر تعليق enum SubscriptionStatus في schema.prisma.
    subscriptionStatus: doctor.subscriptionStatus,
  };

  if (role === Role.DOCTOR) return fullStats;

  // ASSISTANT: عرض تشغيلي "اليوم فقط" — لا شهري، لا إجمالي، لا سعر الاستشارة، لا حالة
  // الاشتراك، لا عدد المرضى، لا نسبة الغياب الإجمالية. هذه الحقول محذوفة من الكائن هنا
  // وليست فقط غير معروضة في React — أي استدعاء مباشر لهذا الـ endpoint من المساعد لن
  // يحصل عليها أبدًا (تحقّق بواسطة اختبارات المرحلة الثالثة).
  return {
    todayAppointments: fullStats.todayAppointments,
    upcomingAppointments: fullStats.upcomingAppointments,
    completedToday: fullStats.completedToday,
    estimatedRevenueToday: fullStats.estimatedRevenueToday,
    avgRating: fullStats.avgRating,
    reviewsCount: fullStats.reviewsCount,
    verificationStatus: fullStats.verificationStatus,
  };
}

export async function getOwnPatients(userId: string) {
  const doctor = await getDoctorByUserId(userId);
  const appointments = await prisma.appointment.findMany({
    where: { doctorId: doctor.id },
    include: { patient: { include: { user: { select: { email: true, phone: true } } } } },
    orderBy: { date: "desc" },
  });

  const map = new Map<string, any>();
  for (const a of appointments) {
    // الحجوزات كضيف (بدون حساب) لا تملك patientId — نستخدم رقم الهاتف كمفتاح تفرّد بديل،
    // وإن لم يتوفر فكل حجز يُعامل كسجل مستقل.
    const key = a.patientId ?? `guest:${a.guestPhone ?? a.id}`;
    if (!map.has(key)) {
      map.set(key, {
        patientId: a.patientId,
        isGuest: !a.patientId,
        firstName: a.patient ? a.patient.firstName : a.guestFirstName,
        lastName: a.patient ? a.patient.lastName : a.guestLastName,
        email: a.patient ? a.patient.user.email : null,
        phone: a.patient?.user.phone ?? a.guestPhone,
        lastVisit: a.date,
        totalAppointments: 1,
      });
    } else {
      map.get(key).totalAppointments += 1;
    }
  }
  return Array.from(map.values());
}
