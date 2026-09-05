import { AppointmentStatus, Prisma, VerificationStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { generateAvailableSlots, isWithinWorkingHours, isPast, algeriaTodayUTCMidnight } from "../../lib/slots";
import { createNotification } from "../notifications/notifications.service";
import { GuestBookingInput, GuestSlotsQuery } from "./booking.schema";

/**
 * حجز "ضيف" بدون تسجيل دخول: المريض لا يختار طبيبًا بعينه،
 * بل يحدد الولاية + التخصص + التاريخ/الوقت، والنظام يعيّن أول طبيب
 * موثّق (VERIFIED) متاح في تلك الفترة تلقائيًا. هذا يبقي على نفس
 * حماية منع التعارض (Double Booking) المستخدمة في نظام الحجز بالحساب.
 */

const SLOT_MINUTES = 20;

// عدد مرات "لم يحضر" التي إذا بلغها رقم هاتف ضيف معيّن (على مستوى المنصة كاملة)
// نمنعه من إجراء حجز ضيف جديد — حماية لوقت الأطباء من الحجوزات المتكررة بدون حضور.
// لا يؤثر هذا على الحجز بحساب مسجَّل (المريض المسجَّل يمكن التواصل معه ومحاسبته إداريًا).
const GUEST_NO_SHOW_LIMIT = 3;

async function checkGuestReliability(phone?: string | null) {
  if (!phone) return;
  const noShowCount = await prisma.appointment.count({
    where: { guestPhone: phone, patientId: null, status: AppointmentStatus.NO_SHOW },
  });
  if (noShowCount >= GUEST_NO_SHOW_LIMIT) {
    throw ApiError.forbidden(
      `تم تقييد الحجز كضيف بهذا الرقم بسبب تكرار عدم الحضور (${noShowCount} مرات سابقة). يرجى إنشاء حساب أو التواصل مع العيادة مباشرة لحجز موعد.`
    );
  }
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const nm = (total % 60).toString().padStart(2, "0");
  return `${nh}:${nm}`;
}

async function findCandidateDoctors(wilayaId: string, specialtyId: string) {
  return prisma.doctor.findMany({
    where: {
      wilayaId,
      specialtyId,
      verificationStatus: VerificationStatus.VERIFIED,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    },
    include: { schedules: true },
    orderBy: [{ avgRating: "desc" }, { reviewsCount: "desc" }],
  });
}

async function bookedRangesForDoctorOnDate(doctorId: string, date: Date) {
  const startOfDay = new Date(date);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  // نستبعد كل فترة يوجد بها سجل موعد مهما كانت حالته (حتى الملغاة أو "لم يحضر")،
  // لأن قاعدة البيانات تفرض تفرّد (طبيب + تاريخ + وقت البداية) بغضّ النظر عن الحالة،
  // فلو اعتبرناها شاغرة لفشل الإدراج بخطأ تعارض بدل أن يأخذ المريض الدور التالي.
  return prisma.appointment.findMany({
    where: {
      doctorId,
      date: { gte: startOfDay, lte: endOfDay },
    },
    select: { startTime: true, endTime: true },
  });
}

/**
 * أول دور متاح لدى طبيب معيّن — قلب نظام "الحجز بالترتيب".
 * المريض لا يختار الوقت: نبدأ من اليوم ونتقدّم يومًا بيوم حتى نجد أول فترة شاغرة
 * ضمن أوقات عمل الطبيب، بطول مدة الجلسة التي حددها هو (مثلاً 5 أو 10 أو 20 دقيقة).
 */
export async function findNextAvailableSlot(doctorId: string, daysAhead = 60) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: { schedules: true, specialty: true, wilaya: true, city: true, clinic: true },
  });
  if (
    !doctor ||
    doctor.verificationStatus !== VerificationStatus.VERIFIED ||
    doctor.subscriptionStatus !== SubscriptionStatus.ACTIVE
  ) {
    throw ApiError.notFound("الطبيب غير موجود أو غير موثّق.");
  }

  const slotMinutes = doctor.slotDurationMin > 0 ? doctor.slotDurationMin : SLOT_MINUTES;

  for (let i = 0; i < daysAhead; i++) {
    const date = algeriaTodayUTCMidnight();
    date.setUTCDate(date.getUTCDate() + i);

    const booked = await bookedRangesForDoctorOnDate(doctor.id, date);
    const slots = generateAvailableSlots(date, doctor.schedules, booked, slotMinutes);
    // نتخطى ما مضى من وقت اليوم — لا يُعطى للمريض دور في ساعة فاتت.
    const next = slots.find((s) => !isPast(date, s));
    if (next) {
      return {
        doctor,
        date,
        dateStr: date.toISOString().slice(0, 10),
        startTime: next,
        endTime: addMinutes(next, slotMinutes),
        slotMinutes,
      };
    }
  }

  throw ApiError.conflict("لا توجد مواعيد متاحة لدى هذا الطبيب خلال الفترة القادمة.");
}

/** معاينة أول دور متاح (تُعرض للمريض قبل تأكيد الحجز). */
export async function previewNextSlot(doctorId: string) {
  const r = await findNextAvailableSlot(doctorId);
  return {
    date: r.dateStr,
    startTime: r.startTime,
    endTime: r.endTime,
    slotMinutes: r.slotMinutes,
    doctor: {
      id: r.doctor.id,
      firstName: r.doctor.firstName,
      lastName: r.doctor.lastName,
      phone: r.doctor.phone,
      address: r.doctor.address,
      specialty: r.doctor.specialty,
      city: r.doctor.city,
      clinic: r.doctor.clinic,
    },
  };
}

/** يرجع قائمة موحّدة (بدون تكرار) بالأوقات المتاحة عبر كل الأطباء الموثّقين المطابقين للولاية والتخصص في تاريخ معيّن. */
export async function getAggregatedSlots(query: GuestSlotsQuery) {
  const date = new Date(query.date + "T00:00:00Z");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");

  const doctors = await findCandidateDoctors(query.wilayaId, query.specialtyId);
  if (doctors.length === 0) return [];

  const slotSet = new Set<string>();
  for (const doctor of doctors) {
    const booked = await bookedRangesForDoctorOnDate(doctor.id, date);
    const slots = generateAvailableSlots(date, doctor.schedules, booked, SLOT_MINUTES);
    for (const s of slots) {
      if (!isPast(date, s)) slotSet.add(s);
    }
  }

  return Array.from(slotSet).sort();
}

/**
 * حجز بالترتيب: النظام يعيّن للمريض أول دور شاغر لدى الطبيب (بطول مدة جلسته)،
 * فيأخذ كل مريض الدور الذي يليه تلقائيًا. نعيد المحاولة عند التسابق (مريضان في نفس اللحظة)
 * لأن الدور قد يُحجز بين لحظة الحساب ولحظة الإدراج.
 */
async function createAutoAssignedAppointment(input: GuestBookingInput, doctorId: string, attempt = 0): Promise<any> {
  const slot = await findNextAvailableSlot(doctorId);

  try {
    const appointment = await prisma.appointment.create({
      data: {
        patientId: null,
        guestFirstName: input.firstName,
        guestLastName: input.lastName,
        guestPhone: input.phone || null,
        doctorId: slot.doctor.id,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        // كل الحجوزات مقبولة تلقائيًا — الطبيب لا يوافق، بل يسجّل لاحقًا: حضر / لم يحضر.
        status: AppointmentStatus.CONFIRMED,
        notes: input.notes,
      },
      include: { doctor: { include: { specialty: true, wilaya: true, city: true, clinic: true } } },
    });

    await createNotification(
      slot.doctor.userId,
      "APPOINTMENT_CREATED",
      "طلب حجز موعد جديد",
      `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} (بدون حساب) بتاريخ ${slot.dateStr} الساعة ${slot.startTime}.`
    );

    return appointment;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 3) {
      // سبقنا مريض آخر إلى نفس الدور — نُعيد الحساب ونمنحه الدور التالي.
      return createAutoAssignedAppointment(input, doctorId, attempt + 1);
    }
    throw err;
  }
}

/**
 * إنشاء حجز ضيف فعلي: يعيد التحقق من التوفر لحظيًا (وليس فقط الاعتماد على ما عُرض للمستخدم سابقًا)،
 * يختار أول طبيب موثّق متاح، وينشئ الموعد بدون ربطه بأي حساب مستخدم.
 */
export async function createGuestAppointment(input: GuestBookingInput) {
  // حماية من الحجوزات المتكررة بدون حضور: نتحقق أولًا قبل أي محاولة حجز.
  await checkGuestReliability(input.phone);

  // الوضع الافتراضي الجديد: لم يُرسل وقت — النظام يعيّن أول دور متاح لدى الطبيب المختار.
  if (input.doctorId && (!input.date || !input.startTime)) {
    return createAutoAssignedAppointment(input, input.doctorId);
  }

  if (!input.date || !input.startTime) {
    throw ApiError.badRequest("الرجاء اختيار الطبيب أولًا.");
  }

  const date = new Date(input.date + "T00:00:00Z");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");

  if (isPast(date, input.startTime)) {
    throw ApiError.badRequest("لا يمكن الحجز في وقت مضى.");
  }

  const endTime = addMinutes(input.startTime, SLOT_MINUTES);

  // المريض اختار طبيبًا محددًا من القائمة المعروضة له — نحجز معه مباشرة (بدون تعيين تلقائي).
  if (input.doctorId) {
    const doctor = await prisma.doctor.findUnique({ where: { id: input.doctorId }, include: { schedules: true } });
    if (
      !doctor ||
      doctor.verificationStatus !== VerificationStatus.VERIFIED ||
      doctor.subscriptionStatus !== SubscriptionStatus.ACTIVE
    ) {
      throw ApiError.notFound("الطبيب غير موجود أو غير موثّق.");
    }
    if (!isWithinWorkingHours(date, input.startTime, endTime, doctor.schedules)) {
      throw ApiError.badRequest("هذا الوقت خارج أوقات عمل الطبيب.");
    }

    const booked = await bookedRangesForDoctorOnDate(doctor.id, date);
    const availableSlots = generateAvailableSlots(date, doctor.schedules, booked, SLOT_MINUTES);
    if (!availableSlots.includes(input.startTime)) {
      throw ApiError.conflict("هذا الوقت لم يعد متاحًا لدى هذا الطبيب. الرجاء اختيار وقت آخر.");
    }

    try {
      const appointment = await prisma.appointment.create({
        data: {
          patientId: null,
          guestFirstName: input.firstName,
          guestLastName: input.lastName,
          guestPhone: input.phone || null,
          doctorId: doctor.id,
          date,
          startTime: input.startTime,
          endTime,
          status: AppointmentStatus.CONFIRMED,
          notes: input.notes,
        },
        include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
      });

      await createNotification(
        doctor.userId,
        "APPOINTMENT_CREATED",
        "طلب حجز موعد جديد",
        `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} (بدون حساب) بتاريخ ${input.date} الساعة ${input.startTime}.`
      );

      return appointment;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw ApiError.conflict("تم حجز هذه الفترة للتو من طرف مستخدم آخر. الرجاء اختيار وقت آخر.");
      }
      throw err;
    }
  }

  // احتياطي (توافقًا مع نداءات قديمة بدون doctorId): تعيين تلقائي لأول طبيب موثّق متاح.
  const doctors = await findCandidateDoctors(input.wilayaId, input.specialtyId);
  if (doctors.length === 0) {
    throw ApiError.notFound("لا يوجد طبيب متاح بهذا التخصص في هذه الولاية حاليًا.");
  }

  for (const doctor of doctors) {
    if (!isWithinWorkingHours(date, input.startTime, endTime, doctor.schedules)) continue;

    const booked = await bookedRangesForDoctorOnDate(doctor.id, date);
    const availableSlots = generateAvailableSlots(date, doctor.schedules, booked, SLOT_MINUTES);
    if (!availableSlots.includes(input.startTime)) continue;

    try {
      const appointment = await prisma.appointment.create({
        data: {
          patientId: null,
          guestFirstName: input.firstName,
          guestLastName: input.lastName,
          guestPhone: input.phone || null,
          doctorId: doctor.id,
          date,
          startTime: input.startTime,
          endTime,
          status: AppointmentStatus.CONFIRMED,
          notes: input.notes,
        },
        include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
      });

      await createNotification(
        doctor.userId,
        "APPOINTMENT_CREATED",
        "طلب حجز موعد جديد",
        `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} (بدون حساب) بتاريخ ${input.date} الساعة ${input.startTime}.`
      );

      return appointment;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // تعارض لحظي مع هذا الطبيب تحديدًا — جرّب الطبيب التالي المطابق قبل الفشل الكامل
        continue;
      }
      throw err;
    }
  }

  throw ApiError.conflict("هذا الوقت لم يعد متاحًا لدى أي طبيب مطابق. الرجاء اختيار وقت آخر.");
}

/**
 * تتبّع حجوزات الضيف: يرجع المواعيد القادمة (غير الملغاة/المكتملة) المرتبطة برقم هاتف معيّن،
 * لأن الحجز كضيف لا يملك حسابًا يمكن الدخول إليه لاحقًا لمراجعة الموعد.
 */
export async function lookupAppointmentsByPhone(phone: string) {
  const startOfToday = algeriaTodayUTCMidnight();

  return prisma.appointment.findMany({
    where: {
      guestPhone: phone,
      patientId: null,
      date: { gte: startOfToday },
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
    },
    include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
}

/**
 * إلغاء حجز ضيف: التحقق من مطابقة رقم الهاتف لصاحب الحجز قبل الإلغاء (بديل التحقق بالحساب).
 */
export async function cancelGuestAppointment(id: string, phone: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: { doctor: true },
  });

  if (!appointment || appointment.patientId !== null) {
    throw ApiError.notFound("الموعد غير موجود.");
  }
  if (appointment.guestPhone !== phone) {
    throw ApiError.forbidden("رقم الهاتف لا يطابق صاحب هذا الحجز.");
  }
  if (appointment.status === AppointmentStatus.CANCELLED) {
    throw ApiError.conflict("تم إلغاء هذا الموعد مسبقًا.");
  }
  if (appointment.status === AppointmentStatus.COMPLETED) {
    throw ApiError.conflict("لا يمكن إلغاء موعد مكتمل.");
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: { status: AppointmentStatus.CANCELLED },
    include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
  });

  await createNotification(
    appointment.doctor.userId,
    "APPOINTMENT_CANCELLED",
    "تم إلغاء موعد",
    `قام ${appointment.guestFirstName} ${appointment.guestLastName} (بدون حساب) بإلغاء موعده بتاريخ ${appointment.date.toISOString().slice(0, 10)} الساعة ${appointment.startTime}.`
  );

  return updated;
}
