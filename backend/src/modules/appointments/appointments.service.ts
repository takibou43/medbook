import { AppointmentStatus, Prisma, Role, SubscriptionStatus, SmsStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { generateAvailableSlots, isWithinWorkingHours, isPast, algeriaTodayUTCMidnight, closingTimeForDate } from "../../lib/slots";
import { createNotification } from "../notifications/notifications.service";
import { sendSms } from "../../lib/sms";
import { CreateAppointmentInput } from "./appointments.schema";

const SLOT_MINUTES = 20;

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const nm = (total % 60).toString().padStart(2, "0");
  return `${nh}:${nm}`;
}

/**
 * إنشاء موعد جديد مع منع كامل للتعارض (Double Booking):
 * 1) رفض المواعيد في الماضي.
 * 2) رفض الحجز خارج أوقات عمل الطبيب.
 * 3) التحقق المسبق من عدم وجود حجز على نفس الفترة (PENDING/CONFIRMED).
 * 4) الاعتماد على قيد فريد (unique) على مستوى قاعدة البيانات [doctorId, date, startTime]
 *    كخط دفاع أخير ضد Race Conditions (طلبين متزامنين لنفس الفترة).
 */
export async function createAppointment(patientUserId: string, input: CreateAppointmentInput) {
  const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
  if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض مرتبط بهذا الحساب.");

  const doctor = await prisma.doctor.findUnique({ where: { id: input.doctorId }, include: { schedules: true } });
  if (!doctor) throw ApiError.notFound("الطبيب غير موجود.");
  if (doctor.verificationStatus !== "VERIFIED") {
    throw ApiError.badRequest("لا يمكن حجز موعد مع طبيب لم يتم التحقق منه بعد.");
  }
  if (doctor.subscriptionStatus !== SubscriptionStatus.ACTIVE) {
    throw ApiError.badRequest("لا يمكن حجز موعد مع هذا الطبيب حاليًا.");
  }

  const date = new Date(input.date + "T00:00:00Z");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");

  if (isPast(date, input.startTime)) {
    throw ApiError.badRequest("لا يمكن الحجز في وقت مضى.");
  }

  const endTime = addMinutes(input.startTime, SLOT_MINUTES);

  if (!isWithinWorkingHours(date, input.startTime, endTime, doctor.schedules)) {
    throw ApiError.badRequest("هذا الوقت خارج أوقات عمل الطبيب.");
  }

  const startOfDay = new Date(date);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const bookedForDay = await prisma.appointment.findMany({
    where: { doctorId: doctor.id, date: { gte: startOfDay, lte: endOfDay }, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] } },
    select: { startTime: true, endTime: true },
  });

  const availableSlots = generateAvailableSlots(date, doctor.schedules, bookedForDay, SLOT_MINUTES);
  if (!availableSlots.includes(input.startTime)) {
    throw ApiError.conflict("هذه الفترة محجوزة مسبقًا أو غير متاحة. الرجاء اختيار فترة أخرى.");
  }

  try {
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        date,
        startTime: input.startTime,
        endTime,
        type: input.type,
        status: AppointmentStatus.PENDING,
        notes: input.notes,
        services: input.serviceIds
          ? { create: input.serviceIds.map((serviceId) => ({ serviceId })) }
          : undefined,
      },
      include: { doctor: true, patient: true, services: { include: { service: true } } },
    });

    await createNotification(
      doctor.userId,
      "APPOINTMENT_CREATED",
      "طلب حجز موعد جديد",
      `لديك طلب حجز جديد من ${appointment.patient!.firstName} ${appointment.patient!.lastName} بتاريخ ${input.date} الساعة ${input.startTime}.`
    );

    return appointment;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // خط الدفاع الأخير: تعارض حدث بين لحظة التحقق ولحظة الإنشاء الفعلي
      throw ApiError.conflict("تم حجز هذه الفترة للتو من طرف مستخدم آخر. الرجاء اختيار فترة أخرى.");
    }
    throw err;
  }
}

export async function listForPatient(patientUserId: string, status?: AppointmentStatus) {
  const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
  if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض مرتبط بهذا الحساب.");

  return prisma.appointment.findMany({
    where: { patientId: patient.id, ...(status ? { status } : {}) },
    include: { doctor: { include: { specialty: true, clinic: true } }, review: true },
    // الترتيب حسب التاريخ فقط غير كافٍ — عدة مواعيد بنفس اليوم كانت تظهر بترتيب عشوائي
    // (ترتيب الإدخال في قاعدة البيانات) بدل ترتيبها الزمني الفعلي. نضيف startTime كمعيار ترتيب ثانٍ.
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
  });
}

const NO_SHOW_RETENTION_DAYS = 10;

/**
 * لا نحذف أو نُلغي موعد المريض بمجرد مرور وقته — يبقى بانتظار حضوره طوال اليوم،
 * وفقط عند وصول وقت إغلاق الطبيب لذلك اليوم دون أن يُسجَّل حضوره يتحوّل تلقائيًا
 * إلى "لم يحضر" فيختفي من القائمة الرئيسية (المواعيد القادمة) وينتقل إلى قائمة
 * "لم يحضروا" المنفصلة. بعد 10 أيام من تاريخ الموعد يُحذف نهائيًا من قاعدة البيانات
 * حتى لا تتراكم بيانات لا فائدة منها. نُنفّذ كل هذا بشكل كسول (lazy) عند كل جلب
 * لقائمة مواعيد الطبيب، لعدم توفر مهام مجدولة (cron) دائمة على الخطة المجانية.
 */
export async function autoExpireStaleAppointments(doctorId: string) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { schedules: true } });
  if (!doctor) return;

  const candidates = await prisma.appointment.findMany({
    where: { doctorId, status: AppointmentStatus.CONFIRMED, date: { lte: algeriaTodayUTCMidnight() } },
    select: { id: true, date: true },
  });

  const toExpire = candidates
    .filter((a) => {
      const closing = closingTimeForDate(a.date, doctor.schedules);
      // يوم بلا فترات عمل معروفة لذلك التاريخ: لا نتركه معلّقًا للأبد، نعتبره منتهيًا بنهاية اليوم.
      return closing ? isPast(a.date, closing) : isPast(a.date, "23:59");
    })
    .map((a) => a.id);

  if (toExpire.length > 0) {
    await prisma.appointment.updateMany({ where: { id: { in: toExpire } }, data: { status: AppointmentStatus.NO_SHOW } });
  }

  // حذف نهائي لمواعيد "لم يحضر" التي مضى على تاريخها أكثر من 10 أيام — تبقى ظاهرة
  // مؤقتًا في قائمة "لم يحضروا" الخاصة بها ثم تختفي تلقائيًا بعد هذه المهلة.
  const retentionCutoff = algeriaTodayUTCMidnight();
  retentionCutoff.setUTCDate(retentionCutoff.getUTCDate() - NO_SHOW_RETENTION_DAYS);
  await prisma.appointment.deleteMany({
    where: { doctorId, status: AppointmentStatus.NO_SHOW, date: { lt: retentionCutoff } },
  });
}

export async function listForDoctor(doctorUserId: string, status?: AppointmentStatus, dateStr?: string) {
  const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
  if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");

  await autoExpireStaleAppointments(doctor.id);

  const dateFilter = dateStr
    ? (() => {
        const d = new Date(dateStr + "T00:00:00Z");
        const end = new Date(d);
        end.setUTCHours(23, 59, 59, 999);
        return { gte: d, lte: end };
      })()
    : undefined;

  const appointments = await prisma.appointment.findMany({
    where: { doctorId: doctor.id, ...(status ? { status } : {}), ...(dateFilter ? { date: dateFilter } : {}) },
    include: { patient: { include: { user: { select: { email: true, phone: true } } } } },
    // الترتيب حسب التاريخ فقط غير كافٍ — عدة مواعيد بنفس اليوم كانت تظهر بترتيب عشوائي
    // (ترتيب الإدخال في قاعدة البيانات) بدل ترتيبها الزمني الفعلي، فيرى الطبيب موعد
    // الساعة 14:00 قبل موعد الساعة 09:00 مثلاً. نضيف startTime كمعيار ترتيب ثانٍ.
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  // نحسب عدد مرات "لم يحضر" السابقة لكل مريض/ضيف ظاهر في هذه القائمة (على مستوى المنصة
  // كاملة، وليس فقط عند هذا الطبيب) لتنبيه الطبيب بصريًا عند تكرار غياب مريض معيّن.
  // نحسبها دفعة واحدة (batch) بدل استعلام منفصل لكل موعد تفاديًا لبطء الأداء.
  const patientIds = Array.from(new Set(appointments.map((a) => a.patientId).filter((id): id is string => !!id)));
  const guestPhones = Array.from(new Set(appointments.map((a) => a.guestPhone).filter((p): p is string => !!p)));

  const [patientNoShows, guestNoShows] = await Promise.all([
    patientIds.length > 0
      ? prisma.appointment.groupBy({
          by: ["patientId"],
          where: { patientId: { in: patientIds }, status: AppointmentStatus.NO_SHOW },
          _count: { _all: true },
        })
      : Promise.resolve([] as { patientId: string | null; _count: { _all: number } }[]),
    guestPhones.length > 0
      ? prisma.appointment.groupBy({
          by: ["guestPhone"],
          where: { guestPhone: { in: guestPhones }, patientId: null, status: AppointmentStatus.NO_SHOW },
          _count: { _all: true },
        })
      : Promise.resolve([] as { guestPhone: string | null; _count: { _all: number } }[]),
  ]);

  const patientNoShowMap = new Map(patientNoShows.map((r) => [r.patientId as string, r._count._all]));
  const guestNoShowMap = new Map(guestNoShows.map((r) => [r.guestPhone as string, r._count._all]));

  return appointments.map((a) => ({
    ...a,
    patientNoShowCount: a.patientId ? patientNoShowMap.get(a.patientId) ?? 0 : a.guestPhone ? guestNoShowMap.get(a.guestPhone) ?? 0 : 0,
  }));
}
export const ALLOWED_TRANSITIONS: Record<Role, Partial<Record<AppointmentStatus, AppointmentStatus[]>>> = {
  PATIENT: {
    PENDING: ["CANCELLED"],
    CONFIRMED: ["CANCELLED"],
  },
  DOCTOR: {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  },
  ADMIN: {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  },
};

/** دالة نقية (بدون قاعدة بيانات) تحدد ما إذا كان الانتقال بين حالتين مسموحًا لدور معيّن — قابلة للاختبار مباشرة. */
export function canTransition(role: Role, from: AppointmentStatus, to: AppointmentStatus): boolean {
  const allowedNext = ALLOWED_TRANSITIONS[role]?.[from] ?? [];
  return allowedNext.includes(to);
}

export async function updateStatus(userId: string, role: Role, appointmentId: string, newStatus: AppointmentStatus) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: true, patient: true },
  });
  if (!appointment) throw ApiError.notFound("الموعد غير موجود.");

  // Ownership check
  if (role === "PATIENT" && appointment.patient?.userId !== userId) throw ApiError.forbidden();
  if (role === "DOCTOR" && appointment.doctor.userId !== userId) throw ApiError.forbidden();

  if (!canTransition(role, appointment.status, newStatus)) {
    throw ApiError.badRequest(`لا يمكن تغيير حالة الموعد من ${appointment.status} إلى ${newStatus}.`);
  }

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: newStatus },
    include: { doctor: true, patient: { include: { user: { select: { phone: true } } } } },
  });

  // عند تسجيل "لم يحضر" نرسل SMS للمريض، مبنية بالكامل من بيانات الموعد الفعلية في قاعدة
  // البيانات (لا أسماء أو نصوص ثابتة). سجل SmsLog واحد فقط لكل موعد (قيد فريد appointmentId)
  // يمنع إعادة الإرسال العشوائي المتكرر سواء نجحت المحاولة الأولى أم فشلت — عند الفشل
  // نحفظ السبب في failureReason ولا نعاود المحاولة تلقائيًا.
  if (newStatus === AppointmentStatus.NO_SHOW) {
    const existingLog = await prisma.smsLog.findUnique({ where: { appointmentId: updated.id } });
    if (!existingLog) {
      const phone = updated.patient?.user?.phone ?? updated.guestPhone;
      if (!phone) {
        await prisma.smsLog.create({
          data: { appointmentId: updated.id, phone: "", status: SmsStatus.FAILED, failureReason: "لا يوجد رقم هاتف مسجل لهذا المريض." },
        });
      } else {
        const patientName = updated.patient?.firstName ?? updated.guestFirstName ?? "";
        const doctorName = `${updated.doctor.firstName} ${updated.doctor.lastName}`;
        const appointmentDate = updated.date.toISOString().slice(0, 10);
        const message = `مرحباً ${patientName}، نعلمك بأن موعدك لدى الدكتور ${doctorName} بتاريخ ${appointmentDate} على الساعة ${updated.startTime} قد فات.`;
        const result = await sendSms(phone, message);
        await prisma.smsLog.create({
          data: {
            appointmentId: updated.id,
            phone,
            status: result.success ? SmsStatus.SENT : SmsStatus.FAILED,
            failureReason: result.success ? null : result.error,
          },
        });
      }
    }
  }

  // المرضى بدون حساب (حجز ضيف) لا يملكون userId لإرسال إشعار داخل التطبيق إليهم —
  // نتجاهل إشعار المريض في هذه الحالة (TODO: إشعار SMS لاحقًا عبر guestPhone).
  const notifyMap: Partial<Record<AppointmentStatus, { userId: string | undefined; title: string; message: string; type: any }>> = {
    CONFIRMED: {
      userId: updated.patient?.userId,
      title: "تم تأكيد موعدك",
      type: "APPOINTMENT_CONFIRMED",
      message: `تم تأكيد موعدك مع د. ${updated.doctor.firstName} ${updated.doctor.lastName} بتاريخ ${updated.date.toISOString().slice(0, 10)} الساعة ${updated.startTime}.`,
    },
    CANCELLED: {
      userId: role === "PATIENT" ? updated.doctor.userId : updated.patient?.userId,
      title: "تم إلغاء الموعد",
      type: "APPOINTMENT_CANCELLED",
      message: `تم إلغاء الموعد بتاريخ ${updated.date.toISOString().slice(0, 10)} الساعة ${updated.startTime}.`,
    },
    COMPLETED: {
      userId: updated.patient?.userId,
      title: "اكتمل موعدك",
      type: "APPOINTMENT_COMPLETED",
      message: `تم إنهاء موعدك مع د. ${updated.doctor.firstName} ${updated.doctor.lastName}. يمكنك الآن تقييم الطبيب.`,
    },
    NO_SHOW: {
      userId: updated.patient?.userId,
      title: "لم تحضر إلى موعدك",
      type: "APPOINTMENT_NO_SHOW",
      message: `تم تسجيل عدم حضورك للموعد بتاريخ ${updated.date.toISOString().slice(0, 10)}.`,
    },
  };

  const notif = notifyMap[newStatus];
  if (notif && notif.userId) await createNotification(notif.userId, notif.type, notif.title, notif.message);

  return updated;
}

export async function cancelByPatient(patientUserId: string, appointmentId: string) {
  return updateStatus(patientUserId, "PATIENT", appointmentId, AppointmentStatus.CANCELLED);
}
