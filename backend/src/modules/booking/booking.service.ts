import { AppointmentStatus, Prisma, VerificationStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { generateAvailableSlots, isWithinWorkingHours, isPast, algeriaTodayUTCMidnight } from "../../lib/slots";
import { SLOT_OCCUPYING_WHERE, RELEASE_SLOT_DATA } from "../../lib/slotOccupancy";
import { lockDoctorQueue, withDoctorQueueTurn, DoctorQueueBusyError } from "../../lib/doctorLock";
import {
  reserveRequestedOrNextSlot,
  reserveExactSlot,
  slotMinutesFor,
  NoSlotAvailableError,
  SlotRaceExhaustedError,
  ExactSlotUnavailableError,
} from "../../lib/slotAssign";

// أقصى انتظار في طابور الحجز لطبيب واحد قبل الرفض بـ503 (أقل من مهلة العميل 45 ثانية).
const QUEUE_TURN_MAX_WAIT_MS = 30_000;
import { createNotification } from "../notifications/notifications.service";
import { GuestBookingInput, GuestSlotsQuery, AvailabilityQuery } from "./booking.schema";
import { estimateSessionMinutes } from "../appointments/appointments.service";
import { locateInQueue, DAY_QUEUE_STATUSES } from "../../lib/doctorQueue";
import { getDoctorAvailability as getDoctorDaySlots } from "../doctors/doctors.service";

/**
 * حجز "ضيف" بدون تسجيل دخول: المريض لا يختار طبيبًا بعينه،
 * بل يحدد الولاية + التخصص + التاريخ/الوقت، والنظام يعيّن أول طبيب
 * موثّق (VERIFIED) متاح في تلك الفترة تلقائيًا. هذا يبقي على نفس
 * حماية منع التعارض (Double Booking) المستخدمة في نظام الحجز بالحساب.
 */

const SLOT_MINUTES = 20;

// وصف صاحب الحجز في إشعار الطبيب: الضيف "(بدون حساب)" كما كان، والمريض المسجَّل "(حساب مريض)".
function accountLabel(patientId: string | null): string {
  return patientId ? "(حساب مريض)" : "(بدون حساب)";
}

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

// db: يمكن تمرير عميل المعاملة (tx) لتتم القراءة والكتابة على نفس الاتصال داخل القفل.
type Db = Prisma.TransactionClient;

async function bookedRangesForDoctorOnDate(doctorId: string, date: Date, db: Db = prisma) {
  const startOfDay = new Date(date);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  // نستبعد كل فترة يشغلها موعد غير ملغى (بما فيها المكتملة و"لم يحضر")، مطابقةً لقيد قاعدة البيانات
  // (doctorId, date, startTime, activeSlot). الموعد الملغى يبقى محفوظًا لكنه يحرّر وقته لحجز جديد.
  return db.appointment.findMany({
    where: {
      doctorId,
      date: { gte: startOfDay, lte: endOfDay },
      ...SLOT_OCCUPYING_WHERE,
    },
    select: { startTime: true, endTime: true },
  });
}

/**
 * أول دور متاح لدى طبيب معيّن — قلب نظام "الحجز بالترتيب".
 * المريض لا يختار الوقت: نبدأ من اليوم ونتقدّم يومًا بيوم حتى نجد أول فترة شاغرة
 * ضمن أوقات عمل الطبيب، بطول مدة الجلسة التي حددها هو (مثلاً 5 أو 10 أو 20 دقيقة).
 */
/** تحميل الطبيب (مع جدوله وعلاقاته) والتحقق من أنه موثّق ومشترك — لا علاقة له بالتسابق فيمكن أداؤه خارج القفل. */
async function loadBookableDoctor(doctorId: string, db: Db = prisma) {
  const doctor = await db.doctor.findUnique({
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
  return doctor;
}

export async function findNextAvailableSlot(doctorId: string, daysAhead = 60, db: Db = prisma) {
  return scanForNextSlot(await loadBookableDoctor(doctorId, db), daysAhead, db);
}

/** المسح يوميًا عن أول فترة شاغرة: هذا الجزء وحده (قراءة المحجوز + الإدراج) يحتاج القفل. */
async function scanForNextSlot(
  doctor: Awaited<ReturnType<typeof loadBookableDoctor>>,
  daysAhead: number,
  db: Db
) {
  const slotMinutes = doctor.slotDurationMin > 0 ? doctor.slotDurationMin : SLOT_MINUTES;

  for (let i = 0; i < daysAhead; i++) {
    const date = algeriaTodayUTCMidnight();
    date.setUTCDate(date.getUTCDate() + i);

    const booked = await bookedRangesForDoctorOnDate(doctor.id, date, db);
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

// ===== اختيار اليوم/الوقت الاختياري =====
// ليس نظام مواعيد منفصلًا: نفس الطبيب القابل للحجز (loadBookableDoctor)، نفس الفترات (generateAvailableSlots:
// أوقات العمل + الاستثناءات + مدة الجلسة)، نفس «المشغول» (كل موعد غير ملغى — الملغى يحرّر وقته)،
// ونفس استبعاد ما مضى من اليوم. الخادم يعيد التحقق كله لحظة الحجز تحت قفل الطبيب.

/** كم يومًا نعرض للمريض ليختار منها. */
export const AVAILABILITY_DAYS = 30;
/** أقصى أفق للحجز (نفس أفق «أول دور متاح»). */
export const BOOKING_HORIZON_DAYS = 60;

export const SLOT_UNAVAILABLE_MESSAGE = "هذا الموعد لم يعد متاحًا، يرجى اختيار وقت آخر.";
export const DAY_UNAVAILABLE_MESSAGE = "هذا اليوم غير متاح لدى الطبيب، يرجى اختيار يوم آخر.";

function freeSlotsOn(doctor: Awaited<ReturnType<typeof loadBookableDoctor>>, date: Date, booked: { startTime: string; endTime: string }[]) {
  return generateAvailableSlots(date, doctor.schedules, booked, slotMinutesFor(doctor)).filter((s) => !isPast(date, s));
}

/** هل التاريخ داخل أفق الحجز (اليوم .. اليوم + 60)؟ */
function withinHorizon(date: Date): boolean {
  const today = algeriaTodayUTCMidnight();
  const last = new Date(today);
  last.setUTCDate(last.getUTCDate() + BOOKING_HORIZON_DAYS - 1);
  return date.getTime() >= today.getTime() && date.getTime() <= last.getTime();
}

/** الأيام المتاحة (بها وقت شاغر واحد على الأقل) أو أوقات يوم معيّن — من قاعدة البيانات مباشرة. */
export async function getDoctorAvailability(query: AvailabilityQuery) {
  const doctor = await loadBookableDoctor(query.doctorId);
  const slotMinutes = slotMinutesFor(doctor);

  if (query.date) {
    const date = new Date(query.date + "T00:00:00Z");
    if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");
    if (!withinHorizon(date)) return { date: query.date, slotMinutes, slots: [] as string[] };
    // نفس دالة «أوقات الطبيب المتاحة» الموجودة (GET /api/doctors/:id/availability) — لا تعريف ثانٍ.
    const { slots } = await getDoctorDaySlots(doctor.id, query.date);
    return { date: query.date, slotMinutes, slots };
  }

  const today = algeriaTodayUTCMidnight();
  const last = new Date(today);
  last.setUTCDate(last.getUTCDate() + AVAILABILITY_DAYS - 1);
  last.setUTCHours(23, 59, 59, 999);
  // استعلام واحد لكل المواعيد الشاغلة في الفترة بدل استعلام لكل يوم.
  const occupying = await prisma.appointment.findMany({
    where: { doctorId: doctor.id, date: { gte: today, lte: last }, ...SLOT_OCCUPYING_WHERE },
    select: { date: true, startTime: true, endTime: true },
  });
  const days: { date: string; freeCount: number; firstTime: string }[] = [];
  for (let i = 0; i < AVAILABILITY_DAYS; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    const booked = occupying.filter((a) => a.date.getTime() === date.getTime());
    const free = freeSlotsOn(doctor, date, booked);
    if (free.length > 0) days.push({ date: date.toISOString().slice(0, 10), freeCount: free.length, firstTime: free[0] });
  }
  return { slotMinutes, days };
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
async function createAutoAssignedAppointment(
  input: GuestBookingInput,
  doctorId: string,
  attempt = 0,
  patientId: string | null = null
): Promise<any> {
  try {
    // قراءة "أول دور شاغر" + إنشاء الموعد معًا داخل معاملة واحدة تحت قفل طابور هذا الطبيب،
    // فلا يستطيع طلب آخر لنفس الطبيب أخذ الدور نفسه بين القراءة والكتابة (كان هذا هو السباق).
    const { appointment, slot } = await withDoctorQueueTurn(doctorId, QUEUE_TURN_MAX_WAIT_MS, async () => {
      // تحميل بيانات الطبيب وعلاقاته (نحو 6 استعلامات) *قبل* فتح المعاملة والقفل: لا تتأثر بالتسابق، وتركها
      // داخل القفل كانت تُطيل الجزء المتسلسل الوحيد في النظام. الخانتان تسمحان بتداخلها مع كتابة الطلب السابق.
      const doctor = await loadBookableDoctor(doctorId);
      return prisma.$transaction(
      async (tx) => {
        await lockDoctorQueue(tx, doctorId);
        const slot = await scanForNextSlot(doctor, 60, tx);
        const created = await tx.appointment.create({
          data: {
            patientId,
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
        });
        // نفس شكل الرد السابق (doctor + specialty/wilaya/city/clinic) لكن من الطبيب المحمَّل مسبقًا
        // بدل 5 استعلامات إضافية داخل القفل.
        const { schedules: _schedules, ...doctorWithRelations } = slot.doctor;
        return { appointment: { ...created, doctor: doctorWithRelations }, slot };
      },
      // الطلبات المتزامنة لنفس الطبيب تنتظر القفل بالدور؛ نرفع مهلة الاتصال/المعاملة لتحمّل الذروة.
      { maxWait: 20000, timeout: 30000 }
      );
    });

    // الإشعار بعد اكتمال المعاملة: فشله لا يجوز أن يجعل حجزًا محفوظًا يبدو فاشلًا (فيُعاد ويتكرر).
    try {
      await createNotification(
        slot.doctor.userId,
        "APPOINTMENT_CREATED",
        "طلب حجز موعد جديد",
        `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} ${accountLabel(patientId)} بتاريخ ${slot.dateStr} الساعة ${slot.startTime}.`,
        undefined,
        undefined,
        { id: appointment.id, date: slot.date }
      );
    } catch (notifyErr) {
      console.error("تعذّر إنشاء إشعار الحجز (الحجز محفوظ):", notifyErr);
    }

    return appointment;
  } catch (err) {
    if (err instanceof DoctorQueueBusyError) {
      throw ApiError.unavailable("الازدحام على هذا الطبيب مرتفع الآن. لم يُسجَّل أي حجز، الرجاء المحاولة بعد لحظات.");
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 3) {
      // خط دفاع أخير: تعارض مع مسار كتابة آخر لا يستخدم القفل (حجز بوقت محدد) — نعيد الحساب.
      return createAutoAssignedAppointment(input, doctorId, attempt + 1, patientId);
    }
    throw err;
  }
}

/**
 * حجز بيوم اختاره المريض (وبوقت اختاره إن أرسله مع exactTime). نفس الطبيب/الفترات/القفل/القيد الفريد.
 *  - اليوم غير متاح (خارج الأفق، يوم عطلة/استثناء، أو لم يبق فيه وقت) → 409 DAY_UNAVAILABLE.
 *  - الوقت المختار غير متاح (محجوز، خارج الدوام أو الشبكة، أو مضى، أو سباق) → 409 SLOT_UNAVAILABLE.
 */
async function createChosenDayAppointment(
  input: GuestBookingInput,
  doctorId: string,
  dateStr: string,
  exactStart: string | null,
  patientId: string | null
) {
  const date = new Date(dateStr + "T00:00:00Z");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");
  const doctor = await loadBookableDoctor(doctorId);
  if (!withinHorizon(date)) throw ApiError.conflict(DAY_UNAVAILABLE_MESSAGE, { code: "DAY_UNAVAILABLE" });

  const create = (tx: Prisma.TransactionClient, slot: { startTime: string; endTime: string }) =>
    tx.appointment.create({
      data: {
        patientId,
        guestFirstName: input.firstName,
        guestLastName: input.lastName,
        guestPhone: input.phone || null,
        doctorId: doctor.id,
        date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: AppointmentStatus.CONFIRMED,
        notes: input.notes,
      },
      include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
    });

  let appointment;
  try {
    if (exactStart) {
      appointment = (await reserveExactSlot({ doctor, date, startTime: exactStart, create })).result;
    } else {
      // اليوم فقط: أول وقت شاغر فيه (نفس دالة «الوقت المطلوب أو أقرب وقت بعده» بدءًا من أول اليوم).
      appointment = (await reserveRequestedOrNextSlot({ doctor, date, requestedStart: "00:00", create })).result;
    }
  } catch (err) {
    if (err instanceof ExactSlotUnavailableError) {
      throw ApiError.conflict(SLOT_UNAVAILABLE_MESSAGE, { code: "SLOT_UNAVAILABLE" });
    }
    if (err instanceof NoSlotAvailableError || err instanceof SlotRaceExhaustedError) {
      throw ApiError.conflict(DAY_UNAVAILABLE_MESSAGE, { code: "DAY_UNAVAILABLE" });
    }
    if (err instanceof DoctorQueueBusyError) {
      throw ApiError.unavailable("الازدحام على هذا الطبيب مرتفع الآن. لم يُسجَّل أي حجز، الرجاء المحاولة بعد لحظات.");
    }
    throw err;
  }

  try {
    await createNotification(
      doctor.userId,
      "APPOINTMENT_CREATED",
      "طلب حجز موعد جديد",
      `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} ${accountLabel(patientId)} بتاريخ ${dateStr} الساعة ${appointment.startTime}.`,
      undefined,
      undefined,
      { id: appointment.id, date: appointment.date }
    );
  } catch (notifyErr) {
    console.error("تعذّر إنشاء إشعار الحجز (الحجز محفوظ):", notifyErr);
  }
  return appointment;
}

/**
 * إنشاء حجز ضيف فعلي: يعيد التحقق من التوفر لحظيًا (وليس فقط الاعتماد على ما عُرض للمستخدم سابقًا)،
 * يختار أول طبيب موثّق متاح، وينشئ الموعد. patientId = null (الافتراضي) حجز ضيف كما كان تمامًا؛
 * وإن مُرّر (مريض مسجَّل الدخول، مُستخرَج من الجلسة في الـcontroller) يُربط الموعد بحسابه، مع إبقاء
 * حقول الاسم/الهاتف كما هي لأن لوحة الطبيب والطابور وSMS «لم يحضر» تعتمد عليها.
 */
export async function createGuestAppointment(input: GuestBookingInput, patientId: string | null = null) {
  // حماية من الحجوزات المتكررة بدون حضور: نتحقق أولًا قبل أي محاولة حجز.
  // تقييد رقم الضيف القديم (مجموع غيابات الضيف منذ البداية، بلا رفع من الإدارة) لا يُطبَّق على
  // حجز صاحب حساب: المريض المسجَّل يخضع للحظر الموحّد في patient_blocks (3 غيابات خلال 7 أيام،
  // يظهر في «المرضى المحظورون» وتستطيع الإدارة رفعه) ويُفحص في المتحكم قبل الوصول إلى هنا.
  if (!patientId) await checkGuestReliability(input.phone);

  // الوضع الافتراضي (بلا يوم ولا وقت): النظام يعيّن أول دور متاح لدى الطبيب المختار — كما كان تمامًا.
  if (input.doctorId && !input.date) {
    return createAutoAssignedAppointment(input, input.doctorId, 0, patientId);
  }

  // اختيار اختياري: اليوم فقط → أول وقت شاغر في ذلك اليوم، أو اليوم + الوقت بالضبط (exactTime).
  if (input.doctorId && input.date && (!input.startTime || input.exactTime)) {
    return createChosenDayAppointment(input, input.doctorId, input.date, input.exactTime ? input.startTime ?? null : null, patientId);
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
    // مدة الموعد = مدة جلسة الطبيب (نفس قاعدة الحجز الآلي والطابور)، والوقت المطلوب يجب أن يقع داخل دوامه.
    const slotMinutes = slotMinutesFor(doctor);
    if (!isWithinWorkingHours(date, input.startTime, addMinutes(input.startTime, slotMinutes), doctor.schedules)) {
      throw ApiError.badRequest("هذا الوقت خارج أوقات عمل الطبيب.");
    }

    // الوقت المطلوب إن كان شاغرًا، وإلا أقرب وقت صالح وشاغر بعده في نفس اليوم — تحت قفل طابور الطبيب،
    // مع القيد الفريد خط دفاع أخير وإعادة حساب عند P2002 (انظر lib/slotAssign.ts). لا 409 بسبب السباق.
    let reserved;
    try {
      reserved = await reserveRequestedOrNextSlot({
        doctor,
        date,
        requestedStart: input.startTime,
        create: (tx, slot) =>
          tx.appointment.create({
            data: {
              patientId,
              guestFirstName: input.firstName,
              guestLastName: input.lastName,
              guestPhone: input.phone || null,
              doctorId: doctor.id,
              date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              status: AppointmentStatus.CONFIRMED,
              notes: input.notes,
            },
            include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
          }),
      });
    } catch (err) {
      if (err instanceof NoSlotAvailableError || err instanceof SlotRaceExhaustedError) {
        throw ApiError.conflict("هذا الوقت لم يعد متاحًا لدى هذا الطبيب. الرجاء اختيار وقت آخر.");
      }
      if (err instanceof DoctorQueueBusyError) {
        throw ApiError.unavailable("الازدحام على هذا الطبيب مرتفع الآن. لم يُسجَّل أي حجز، الرجاء المحاولة بعد لحظات.");
      }
      throw err;
    }
    const appointment = reserved.result;

    // الإشعار بعد اكتمال المعاملة وبالوقت المحجوز فعليًا (قد يختلف عن المطلوب)، وفشله لا يُفشل حجزًا محفوظًا.
    try {
      await createNotification(
        doctor.userId,
        "APPOINTMENT_CREATED",
        "طلب حجز موعد جديد",
        `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} ${accountLabel(patientId)} بتاريخ ${input.date} الساعة ${appointment.startTime}.`,
        undefined,
        undefined,
        { id: appointment.id, date: appointment.date }
      );
    } catch (notifyErr) {
      console.error("تعذّر إنشاء إشعار الحجز (الحجز محفوظ):", notifyErr);
    }

    // requestedStartTime: ليعرف العميل أن الوقت نُقل تلقائيًا إن كان المطلوب قد حُجز.
    return { ...appointment, requestedStartTime: input.startTime, shiftedFromRequested: reserved.shifted };
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
          patientId,
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
        `لديك طلب حجز جديد من ${input.firstName} ${input.lastName} ${accountLabel(patientId)} بتاريخ ${input.date} الساعة ${input.startTime}.`,
        undefined,
        undefined,
        { id: appointment.id, date: appointment.date }
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
    data: { status: AppointmentStatus.CANCELLED, ...RELEASE_SLOT_DATA },
    include: { doctor: { include: { specialty: true, wilaya: true, city: true } } },
  });

  await createNotification(
    appointment.doctor.userId,
    "APPOINTMENT_CANCELLED",
    "تم إلغاء موعد",
    `قام ${appointment.guestFirstName} ${appointment.guestLastName} (بدون حساب) بإلغاء موعده بتاريخ ${appointment.date.toISOString().slice(0, 10)} الساعة ${appointment.startTime}.`,
    undefined,
    undefined,
    { id: appointment.id, date: appointment.date }
  );

  return updated;
}

/**
 * حالة دور المريض لحظيًا — نقطة عامة (بلا تسجيل دخول) يفتحها المريض برابط موعده.
 *
 * الأمان والخصوصية: معرّف الموعد UUID غير قابل للتخمين، ولا نُرجع أبدًا أي بيانات
 * عن مرضى آخرين — أرقامًا مجرّدة فقط (كم واحدًا يسبقك). حتى لو تسرّب الرابط،
 * أقصى ما يكشفه هو موعد صاحبه هو نفسه.
 */
export async function getAppointmentQueueStatus(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { include: { specialty: true, clinic: true, city: true } } },
  });
  if (!appointment) throw ApiError.notFound("الموعد غير موجود.");

  const doctor = appointment.doctor;
  const slotMinutes = doctor.slotDurationMin > 0 ? doctor.slotDurationMin : SLOT_MINUTES;

  const today = algeriaTodayUTCMidnight();
  const isToday = appointment.date.getTime() === today.getTime();

  const base = {
    id: appointment.id,
    date: appointment.date.toISOString().slice(0, 10),
    startTime: appointment.startTime,
    status: appointment.status,
    patientName: [appointment.guestFirstName, appointment.guestLastName].filter(Boolean).join(" ").trim(),
    slotMinutes,
    deferredCount: appointment.deferredCount,
    skipCredits: appointment.skipCredits,
    doctor: {
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      specialty: doctor.specialty?.nameAr ?? null,
      address: doctor.clinic?.address ?? doctor.address ?? null,
      phone: doctor.clinic?.phone ?? doctor.phone ?? null,
    },
  };

  // موعد في يوم آخر: لا معنى لرقم دور اليوم، نكتفي بتفاصيل الموعد.
  if (!isToday) {
    return { ...base, isToday: false, position: null, aheadOfYou: null, estimatedWaitMinutes: null, someoneInside: false };
  }

  const endOfDay = new Date(today);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const dayQueue = await prisma.appointment.findMany({
    where: {
      doctorId: doctor.id,
      date: { gte: today, lte: endOfDay },
      status: { in: DAY_QUEUE_STATUSES },
    },
    select: { id: true, startTime: true, status: true, skipCredits: true, calledAt: true },
    orderBy: [{ startTime: "asc" }],
  });

  const someoneInside = dayQueue.some((a) => a.status === AppointmentStatus.IN_PROGRESS);

  // من يسبقك فعليًا: المريض الجالس بالداخل الآن + من يسبقك في ترتيب المناداة المتوقع، محسوبًا بنفس
  // قواعد الطابور التي يستعملها الطبيب (lib/queueOrder.ts) — ومنها تراجع المتأخر 2 ثم 4 مراكز.
  // (التعريف المشترك في lib/doctorQueue.ts — يستعمله أيضًا تذكير الـ5 دقائق وتنبيه «دورك اقترب».)
  const { aheadOfYou } = locateInQueue(dayQueue, appointment.id);

  // المدة الذكية: متوسط مدة آخر جلسات هذا الطبيب الفعلية (calledAt إلى endedAt)، وليس
  // الوقت المجدول للموعد — فتقدير الانتظار يعكس سير العيادة الحقيقي.
  const sessionMinutes = await estimateSessionMinutes(doctor.id);

  return {
    ...base,
    isToday: true,
    aheadOfYou,
    position: aheadOfYou + 1,
    estimatedWaitMinutes: aheadOfYou * sessionMinutes,
    someoneInside,
  };
}
