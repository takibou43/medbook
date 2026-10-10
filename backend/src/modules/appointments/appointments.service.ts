import { isDoctorSubscriptionActive } from "../../lib/clinicBilling";
import { firstPresent, presentQueueOrder } from "../../lib/presentQueue";
import { assertReception, hasOnDutyAssistant } from "../shifts/shifts.service";
import { algeriaDayStart } from "../../lib/doctorQueue";
import { assertNotOwnDoctor } from "../../lib/accountProfiles";
import { singleFlight } from "../../lib/singleFlight";
import { liveUpdates } from "../../lib/liveUpdates";
import { safeErrorCode } from "../../lib/safeError";
import { AppointmentStatus, Prisma, Role, SmsStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { isWithinWorkingHours, isPast, algeriaTodayUTCMidnight, closingTimeForDate } from "../../lib/slots";
import { createNotification } from "../notifications/notifications.service";
import { sendSms } from "../../lib/sms";
import { lockDoctorCalls, DoctorQueueBusyError } from "../../lib/doctorLock";
import { reserveRequestedOrNextSlot, slotMinutesFor, NoSlotAvailableError, SlotRaceExhaustedError } from "../../lib/slotAssign";
import { CreateAppointmentInput } from "./appointments.schema";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { latePenaltyFor } from "../../lib/queueOrder";
import { assertPatientCanBook, evaluateAutoBlockSafe } from "../patientBlocks/patientBlocks.service";
import { RELEASE_SLOT_DATA } from "../../lib/slotOccupancy";
import { appointmentNotificationTag } from "../../lib/appointmentExpiry";
import { beneficiaryOf, FAMILY_MEMBER_PUBLIC_SELECT } from "../../lib/beneficiary";
import { syncDentalFollowUps, syncDentalFollowUpsSafe } from "../../lib/dentalFollowUpSync";
import { resolveBookableFamilyMember } from "../family/family.service";
import { writeAudit } from "../../lib/audit";
import { statusTimingError } from "../../lib/appointmentTiming";
import { applyAppointmentPrice, loadFinancialCreate, patientPriceFor, PUBLIC_TERMS_SELECT, withAppointmentPrice } from "../../lib/clinicFinance";

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
 * 3) الوقت المطلوب إن كان شاغرًا، وإلا أقرب وقت شاغر بعده في نفس اليوم، تحت قفل طابور الطبيب.
 * 4) القيد الفريد [doctorId, date, startTime, activeSlot] خط دفاع أخير، و P2002 يُعاد معه الحساب.
 */
export async function createAppointment(patientUserId: string, input: CreateAppointmentInput) {
  await assertNotOwnDoctor(patientUserId, input.doctorId);
  const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
  if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض مرتبط بهذا الحساب.");
  await assertPatientCanBook(patient.id);
  // حجز لفرد من العائلة: الملكية تُفحص في الخادم (المعرّف + صاحب الجلسة + غير مؤرشف).
  const familyMember = input.familyMemberId ? await resolveBookableFamilyMember(patient.id, input.familyMemberId) : null;

  const doctor = await prisma.doctor.findUnique({ where: { id: input.doctorId }, include: { schedules: true, user: { select: { isActive: true } } } });
  if (!doctor) throw ApiError.notFound("الطبيب غير موجود.");
  if (doctor.verificationStatus !== "VERIFIED") {
    throw ApiError.badRequest("لا يمكن حجز موعد مع طبيب لم يتم التحقق منه بعد.");
  }
  if (!(await isDoctorSubscriptionActive(doctor))) {
    throw ApiError.badRequest("لا يمكن حجز موعد مع هذا الطبيب حاليًا.");
  }

  const financial = await loadFinancialCreate(doctor.id);
  const date = new Date(input.date + "T00:00:00Z");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");

  if (isPast(date, input.startTime)) {
    throw ApiError.badRequest("لا يمكن الحجز في وقت مضى.");
  }

  // مدة الموعد = مدة جلسة الطبيب (نفس قاعدة الحجز الآلي والطابور)، والوقت المطلوب يجب أن يقع داخل دوامه.
  const slotMinutes = slotMinutesFor(doctor);
  if (!isWithinWorkingHours(date, input.startTime, addMinutes(input.startTime, slotMinutes), doctor.schedules)) {
    throw ApiError.badRequest("هذا الوقت خارج أوقات عمل الطبيب.");
  }

  // الوقت المطلوب إن كان شاغرًا، وإلا أقرب وقت صالح وشاغر بعده في نفس اليوم (تحت قفل طابور الطبيب،
  // والقيد الفريد خط دفاع أخير، وإعادة حساب عند P2002 — انظر lib/slotAssign.ts). لا 409 بسبب السباق.
  let reserved;
  try {
    reserved = await reserveRequestedOrNextSlot({
      doctor,
      date,
      requestedStart: input.startTime,
      create: (tx, slot) =>
        tx.appointment.create({
          data: {
            patientId: patient.id,
            doctorId: doctor.id,
            financial,
            date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            type: input.type,
            status: AppointmentStatus.PENDING,
            notes: input.notes,
            familyMemberId: familyMember?.id ?? null,
            ...(familyMember ? { guestFirstName: familyMember.firstName, guestLastName: familyMember.lastName } : {}),
            createdBy: "PATIENT",
            createdByUserId: patientUserId,
            services: input.serviceIds
              ? { create: input.serviceIds.map((serviceId) => ({ serviceId })) }
              : undefined,
          },
          include: { doctor: true, patient: true, services: { include: { service: true } } },
        }),
    });
  } catch (err) {
    if (err instanceof NoSlotAvailableError || err instanceof SlotRaceExhaustedError) {
      throw ApiError.conflict("هذه الفترة محجوزة مسبقًا أو غير متاحة. الرجاء اختيار فترة أخرى.");
    }
    if (err instanceof DoctorQueueBusyError) {
      throw ApiError.unavailable("الازدحام على هذا الطبيب مرتفع الآن. لم يُسجَّل أي حجز، الرجاء المحاولة بعد لحظات.");
    }
    throw err;
  }
  const appointment = reserved.result;

  return { ...applyAppointmentPrice(appointment, financial.create.priceDzd), requestedStartTime: input.startTime, shiftedFromRequested: reserved.shifted };
}

export async function listForPatient(patientUserId: string, status?: AppointmentStatus) {
  const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
  if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض مرتبط بهذا الحساب.");

  const rows = await prisma.appointment.findMany({
    where: { patientId: patient.id, ...(status ? { status } : {}) },
    include: {
      doctor: { include: { specialty: true, clinic: true, clinicTerms: PUBLIC_TERMS_SELECT } },
      review: true,
      familyMember: { select: FAMILY_MEMBER_PUBLIC_SELECT },
      financial: { select: { priceDzd: true } },
    },
    // الترتيب حسب التاريخ فقط غير كافٍ — عدة مواعيد بنفس اليوم كانت تظهر بترتيب عشوائي
    // (ترتيب الإدخال في قاعدة البيانات) بدل ترتيبها الزمني الفعلي. نضيف startTime كمعيار ترتيب ثانٍ.
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
  });
  return rows.map((a) => ({ ...withAppointmentPrice(a), beneficiary: beneficiaryOf(a) }));
}

/**
 * الحالات غير المحسومة وحدها مرشَّحة لاعتماد الغياب عند انتهاء الدوام. المكتملة
 * (COMPLETED) والملغاة (CANCELLED) والمعتمدة أصلًا (NO_SHOW) والمعلّقة قبل التأكيد
 * (PENDING) لا تُمسّ إطلاقًا — ولهذا فإن تكرار العملية لا يغيّر شيئًا (idempotent).
 */
export const EXPIRABLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.LATE,
  AppointmentStatus.IN_PROGRESS,
];

/**
 * من كان بالداخل عند الإغلاق (IN_PROGRESS) دخل فعلًا على الطبيب فموعده مكتمل، ومن بقي
 * مؤكَّدًا أو متأخرًا حتى الإغلاق فهو غياب نهائي. دالة نقية قابلة للاختبار مباشرة.
 */
export function classifyDueAppointments<T extends { id: string; status: AppointmentStatus }>(due: T[]) {
  return {
    seen: due.filter((a) => a.status === AppointmentStatus.IN_PROGRESS).map((a) => a.id),
    missed: due.filter((a) => a.status !== AppointmentStatus.IN_PROGRESS).map((a) => a.id),
  };
}

/**
 * لا نحذف أو نُلغي موعد المريض بمجرد مرور وقته — يبقى بانتظار حضوره طوال اليوم،
 * وفقط عند وصول وقت إغلاق الطبيب لذلك اليوم دون أن يُسجَّل حضوره يتحوّل تلقائيًا
 * إلى "لم يحضر"، فيختفي من طابور اليوم ومن المواعيد النشطة/القادمة وينتقل إلى
 * قائمة "لم يحضروا" المنفصلة.
 *
 * سجل الموعد نفسه لا يُحذف من قاعدة البيانات أبدًا: الغياب يجب أن يبقى محفوظًا لأنه
 * يُحتسب في إحصائيات الطبيب (noShowAppointments / noShowRate) وفي تقييد الحجز كضيف
 * بعد تكرار الغياب (GUEST_NO_SHOW_LIMIT). كان هنا سابقًا حذف نهائي لمواعيد "لم يحضر"
 * الأقدم من 10 أيام وقد أُلغي لهذا السبب.
 *
 * التنفيذ كسول (lazy) عند كل جلب لقائمة مواعيد الطبيب أو طابوره أو إحصائياته، لعدم
 * توفر مهام مجدولة (cron) دائمة على الخطة المجانية.
 */
export async function autoExpireStaleAppointments(doctorId: string) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { schedules: true } });
  if (!doctor) return;

  const candidates = await prisma.appointment.findMany({
    where: {
      doctorId,
      // المتأخر الذي لم يعد حتى إغلاق العيادة، ومن نودي عليه ولم يُسجّل إنهاء موعده،
      // ينتهيان إلى "لم يحضر" مثل المؤكّد تمامًا — وإلا بقيا معلّقين في الطابور إلى الأبد.
      status: { in: EXPIRABLE_STATUSES },
      date: { lte: algeriaTodayUTCMidnight() },
    },
    select: { id: true, date: true, status: true, patientId: true },
  });

  const due = candidates.filter((a) => {
    if (a.date >= algeriaTodayUTCMidnight() || a.status === AppointmentStatus.IN_PROGRESS) return false;
    const closing = closingTimeForDate(a.date, doctor.schedules);
    // يوم بلا فترات عمل معروفة لذلك التاريخ: لا نتركه معلّقًا للأبد، نعتبره منتهيًا بنهاية اليوم.
    return closing ? isPast(a.date, closing) : isPast(a.date, "23:59");
  });

  // من كان بالداخل عند إغلاق العيادة (IN_PROGRESS) فقد نودي عليه ودخل فعلًا على الطبيب،
  // فنعتبر موعده مكتملًا لا غيابًا. وسمُه بـ"لم يحضر" ظلمٌ له ويرفع عدّاد غيابه الذي قد
  // يمنعه من الحجز كضيف لاحقًا (الحد ثلاث مرات) — وكل ذلك لمجرد أن الطبيب نسي زر الإنهاء.
  const { seen, missed } = classifyDueAppointments(due);

  if (seen.length > 0) {
    await prisma.appointment.updateMany({ where: { id: { in: seen } }, data: { status: AppointmentStatus.COMPLETED } });
    await syncDentalFollowUpsSafe(seen, "COMPLETED");
  }

  if (missed.length > 0) {
    await prisma.appointment.updateMany({ where: { id: { in: missed } }, data: { status: AppointmentStatus.NO_SHOW } });
    await syncDentalFollowUpsSafe(missed, "NO_SHOW");
    // غياب نهائي جديد → إعادة تقييم الحظر التلقائي (3 غيابات خلال 7 أيام) لكل مريض حساب معني.
    const missedSet = new Set(missed);
    const patientIds = new Set(due.filter((a) => missedSet.has(a.id) && a.patientId).map((a) => a.patientId as string));
    for (const pid of patientIds) await evaluateAutoBlockSafe(pid);
  }

  // لا حذف بعد اليوم: مواعيد "لم يحضر" تبقى محفوظة في قاعدة البيانات دائمًا لتُحتسب
  // ضمن إحصائيات الغياب وسجل المريض، وتظهر فقط في قائمة "لم يحضروا" لا في النشطة.
}

/** Only doctors with unresolved appointments today or earlier can need expiry work. */
export async function listAppointmentExpiryCandidates(now = new Date()) {
  const where = {
    status: { in: EXPIRABLE_STATUSES },
    date: { lte: algeriaDayStart(now) },
  };
  return prisma.doctor.findMany({
    where: { appointments: { some: where } },
    select: {
      id: true, schedules: true,
      appointments: { where, select: { date: true }, orderBy: { date: "asc" }, take: 1 },
    },
  });
}

/**
 * كنس دوري لكل الأطباء بنفس قاعدة انتهاء الدوام أعلاه، دون انتظار أن يفتح أحد لوحة
 * الطبيب. ضروري حتى يُعتمد غياب من لم يحضر حتى إغلاق العيادة ولو لم يفتح الطبيب ولا
 * مساعده التطبيق بقية اليوم. يعمل داخل خادم Express الدائم (Render) عبر جدولة تكيفية في
 * src/index.ts — الواجهات وحدها على Vercel، فلا علاقة لدوالها بهذه المهمة.
 *
 * آمن للتكرار تمامًا: لا يلمس إلا المواعيد غير المحسومة (CONFIRMED / LATE / IN_PROGRESS)
 * التي فات وقت إغلاق يومها، ولا يمسّ المكتملة ولا الملغاة ولا المستقبلية، وكل طبيب
 * يُعالَج بمواعيده وحده. فشل طبيب واحد لا يوقف البقية.
 */
export async function sweepStaleAppointmentsForAllDoctors() {
  try {
    const doctors = await listAppointmentExpiryCandidates();
    for (const doctor of doctors) {
      const day = doctor.appointments[0]?.date;
      if (!day || !isPast(day, closingTimeForDate(day, doctor.schedules) ?? "23:59")) continue;
      try {
        await autoExpireStaleAppointments(doctor.id);
      } catch (err) {
        console.error(`تعذّر اعتماد غيابات الطبيب:`, safeErrorCode(err));
      }
    }
  } catch (err) {
    console.error("تعذّر تشغيل كنس المواعيد المنتهية:", safeErrorCode(err));
  }
}

export async function listForDoctor(
  doctorUserId: string,
  role: Role,
  status?: AppointmentStatus,
  dateStr?: string,
  range?: { from?: string; to?: string }
) {
  // يعمل لحساب الطبيب نفسه أو لحساب مساعده — resolveActingDoctorId تتحقق من الدور
  // والملكية والتفعيل (isActive) قبل إرجاع doctorId، فلا مواعيد طبيب آخر تصل أبدًا هنا.
  const doctorId = await resolveActingDoctorId(doctorUserId, role);

  await autoExpireStaleAppointments(doctorId);

  // يوم واحد (date) أو فترة (from/to، شاملتان) — التاريخ مخزَّن عند 00:00 UTC كتاريخ تقويمي جزائري.
  const dateFilter = dateStr
    ? (() => {
        const d = new Date(dateStr + "T00:00:00Z");
        const end = new Date(d);
        end.setUTCHours(23, 59, 59, 999);
        return { gte: d, lte: end };
      })()
    : range?.from || range?.to
    ? {
        ...(range.from ? { gte: new Date(range.from + "T00:00:00Z") } : {}),
        ...(range.to ? { lte: new Date(range.to + "T23:59:59.999Z") } : {}),
      }
    : undefined;

  const appointments = await prisma.appointment.findMany({
    where: { doctorId, ...(status ? { status } : {}), ...(dateFilter ? { date: dateFilter } : {}) },
    include: {
      patient: { include: { user: { select: { email: true, phone: true } } } },
      // المستفيد إن كان الحجز لفرد من العائلة: الاسم وصلة القرابة فقط (لا تاريخ ميلاد ولا جنس).
      familyMember: { select: FAMILY_MEMBER_PUBLIC_SELECT },
    },
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
    beneficiary: beneficiaryOf(a),
    patientNoShowCount: a.patientId ? patientNoShowMap.get(a.patientId) ?? 0 : a.guestPhone ? guestNoShowMap.get(a.guestPhone) ?? 0 : 0,
  }));
}
export const ALLOWED_TRANSITIONS: Record<Role, Partial<Record<AppointmentStatus, AppointmentStatus[]>>> = {
  CLINIC_OWNER: {},
  PATIENT: {
    PENDING: ["CANCELLED"],
    CONFIRMED: ["CANCELLED"],
    RESCHEDULE_REQUIRED: ["CANCELLED"],
  },
  DOCTOR: {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["IN_PROGRESS", "LATE", "COMPLETED", "CANCELLED", "NO_SHOW"],
    IN_PROGRESS: ["COMPLETED", "LATE", "CANCELLED", "NO_SHOW"],
    LATE: ["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"],
    // "لم يحضر" ليست نهاية القصة: كثيرًا ما يسجّل الطبيب الغياب بعد فوات الموعد ثم
    // يصل المريض بعد دقائق. نسمح بإرجاعه إلى IN_PROGRESS فقط (أي "أدخله الآن")؛
    // إرجاعه إلى CONFIRMED لا يصلح لأن autoExpireStaleAppointments يعيده إلى
    // NO_SHOW عند أول جلب للقائمة بعد وقت إغلاق العيادة، بينما IN_PROGRESS تصبح
    // COMPLETED عند الإغلاق — وهو الصحيح لمريض دخل فعلًا على الطبيب.
    NO_SHOW: ["IN_PROGRESS"],
    RESCHEDULE_REQUIRED: ["CANCELLED"],
  },
  // صلاحيات الطابور اليومي مثل الطبيب، باستثناء واحد: «إنهاء الموعد» (COMPLETED) للطبيب وحده —
  // الطبيب هو من يتحكم في إنهاء الموعد. المساعد لا يملك أي صلاحية خارج المواعيد/الطابور أصلًا.
  // (الإغلاق التلقائي آخر الدوام IN_PROGRESS → COMPLETED يتم من الخادم ولا يمر بهذه القواعد.)
  ASSISTANT: {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["IN_PROGRESS", "LATE", "CANCELLED", "NO_SHOW"],
    IN_PROGRESS: ["LATE", "CANCELLED", "NO_SHOW"],
    LATE: ["IN_PROGRESS", "CANCELLED", "NO_SHOW"],
    NO_SHOW: ["IN_PROGRESS"],
    RESCHEDULE_REQUIRED: ["CANCELLED"],
  },
  ADMIN: {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["IN_PROGRESS", "LATE", "COMPLETED", "CANCELLED", "NO_SHOW"],
    IN_PROGRESS: ["COMPLETED", "LATE", "CANCELLED", "NO_SHOW"],
    LATE: ["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
    RESCHEDULE_REQUIRED: ["CANCELLED"],
  },
};

/** دالة نقية (بدون قاعدة بيانات) تحدد ما إذا كان الانتقال بين حالتين مسموحًا لدور معيّن — قابلة للاختبار مباشرة. */
export function canTransition(role: Role, from: AppointmentStatus, to: AppointmentStatus): boolean {
  const allowedNext = ALLOWED_TRANSITIONS[role]?.[from] ?? [];
  return allowedNext.includes(to);
}

export async function updateStatus(userId: string, role: Role, appointmentId: string, newStatus: AppointmentStatus) {
  if (newStatus === AppointmentStatus.IN_PROGRESS) return callSpecificPatient(userId, appointmentId, role as Role);
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: true, patient: true },
  });
  if (!appointment) throw ApiError.notFound("الموعد غير موجود.");

  // Ownership check
  if (role === "PATIENT" && appointment.patient?.userId !== userId) throw ApiError.forbidden();
  if (role === "DOCTOR" && appointment.doctor.userId !== userId) throw ApiError.forbidden();
  // المساعد: يُشتق الطبيب الذي يعمل نيابة عنه من علاقته المُسجَّلة (resolveActingDoctorId) لا
  // من أي حقل في الطلب — فلا يمكنه أبدًا تغيير حالة موعد عند طبيب آخر غير طبيبه.
  if (role === "ASSISTANT") {
    const actingDoctorId = await resolveActingDoctorId(userId, role);
    if (appointment.doctorId !== actingDoctorId) throw ApiError.forbidden();
  }

  // الموعد في الحالة المطلوبة أصلًا = طلب مكرر أو خاسر في سباق (طبيب ومساعد يضغطان معًا): 409 دائمًا،
  // مثل خاسر الـcompare-and-swap أدناه، بدل 400 يتوقف على توقيت وصول الطلب (قبل/بعد commit الفائز).
  if (appointment.status === newStatus) {
    throw ApiError.conflict("تغيّرت حالة الموعد للتو. حدّث الصفحة وأعد المحاولة.");
  }
  if (!canTransition(role, appointment.status, newStatus)) {
    throw ApiError.badRequest(`لا يمكن تغيير حالة الموعد من ${appointment.status} إلى ${newStatus}.`);
  }
  // قيود التوقيت (lib/appointmentTiming): لا «لم يحضر» قبل وقت الموعد، ولا إنهاء/إدخال لموعد يومه لم يأتِ.
  if (role !== Role.PATIENT) {
    const timingError = statusTimingError(appointment, newStatus, Date.now());
    if (timingError) throw ApiError.badRequest(timingError);
  }

  // «متأخر» عبر PATCH العام يمرّ بنفس منطق زر «متأخر» في الطابور (عقوبة المراكز، منع التكرار،
  // إشعار المريض) — بدل تغيير الحالة وحدها فيعود المريض فورًا دون أن يمر قبله أحد.
  if (newStatus === AppointmentStatus.LATE && (role === Role.DOCTOR || role === Role.ASSISTANT)) {
    return markAsLate(userId, appointmentId, role);
  }

  let extraData: Prisma.AppointmentUpdateInput = {};
  if (newStatus === AppointmentStatus.COMPLETED) {
    const endedAt = new Date();
    extraData.endedAt = endedAt;
    if (appointment.calledAt) {
      extraData.durationMinutes = Math.round((endedAt.getTime() - appointment.calledAt.getTime()) / 60000);
    }
  } else if (newStatus === AppointmentStatus.CANCELLED) {
    // الموعد الملغى يبقى محفوظًا، لكنه يحرّر وقته لحجز جديد (انظر lib/slotOccupancy).
    Object.assign(extraData, RELEASE_SLOT_DATA);
  } else if (newStatus === AppointmentStatus.NO_SHOW) {
    extraData.calledAt = null;
    extraData.arrivedAt = null;
  }

  // انتقال ذرّي (compare-and-swap): نكتب فقط إن كانت الحالة ما زالت كما قرأناها. طلبان متزامنان
  // (نقرة مزدوجة/إعادة محاولة) كانا ينجحان معًا فيُرسل SMS "لم يحضر" أكثر من مرة؛ الآن يفوز
  // واحد فقط ويأخذ الآخر 409 دون أي أثر جانبي.
  let updated;
  try {
    // تغيير الحالة + مزامنة متابعة خطة الأسنان المرتبطة (إن وُجدت) في معاملة واحدة: إلغاء موعد العودة
    // يعيد المتابعة إلى DUE، واكتماله يجعلها COMPLETED — لا حالة وسيطة غير متسقة.
    updated = await prisma.$transaction(async (tx) => {
      if (newStatus === AppointmentStatus.LATE || newStatus === AppointmentStatus.NO_SHOW) await assertReception(userId, role, appointment.doctorId, tx);
      const row = await tx.appointment.update({
        where: { id: appointmentId, status: appointment.status },
        data: { status: newStatus, ...extraData },
        include: { doctor: true, patient: { include: { user: { select: { phone: true } } } } },
      });
      if (newStatus === AppointmentStatus.CANCELLED || newStatus === AppointmentStatus.NO_SHOW || newStatus === AppointmentStatus.COMPLETED) {
        await syncDentalFollowUps([row.id], newStatus, tx);
      }
      return row;
    }, { maxWait: 10000, timeout: 15000 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw ApiError.conflict("تغيّرت حالة الموعد للتو. حدّث الصفحة وأعد المحاولة.");
    }
    throw err;
  }

  // موعد عودة برمجه الطبيب: إلغاؤه من طرف الطبيب/المساعد/الإدارة يُسجَّل في AuditLog (بلا بيانات طبية).
  if (newStatus === AppointmentStatus.CANCELLED && appointment.createdBy === "DOCTOR" && role !== Role.PATIENT) {
    try {
      await writeAudit({
        userId,
        action: "FOLLOW_UP_APPOINTMENT_CANCELLED",
        entity: "Appointment",
        entityId: appointment.id,
        meta: { date: appointment.date.toISOString().slice(0, 10), startTime: appointment.startTime, byRole: role },
      });
    } catch (err) {
      console.error("تعذّر تسجيل إلغاء موعد العودة في سجل التدقيق:", safeErrorCode(err));
    }
  }

  // الحظر التلقائي: بعد تثبيت NO_SHOW (commit) نعيد عدّ غيابات المريض خلال آخر 7 أيام.
  // LATE لا يمر من هنا أصلًا (markAsLate أعلاه) فلا يُحتسب غيابًا.
  if (newStatus === AppointmentStatus.NO_SHOW) await evaluateAutoBlockSafe(updated.patientId);

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
      userId: role === "PATIENT" ? undefined : updated.patient?.userId,
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
  // إشعار موعد: ينتهي بانتهاء يوم الموعد. للمريض وسم موحّد للموعد (appt-<id>) فيستبدل إشعاره السابق على الهاتف.
  if (notif && notif.userId) {
    const toPatient = notif.userId === updated.patient?.userId;
    await createNotification(
      notif.userId,
      notif.type,
      notif.title,
      notif.message,
      toPatient ? `/account?appointment=${updated.id}` : undefined,
      toPatient ? appointmentNotificationTag(updated.id) : undefined,
      { id: updated.id, date: updated.date }
    );
  }

  return updated;
}

export async function cancelByPatient(patientUserId: string, appointmentId: string) {
  const updated = await updateStatus(patientUserId, "PATIENT", appointmentId, AppointmentStatus.CANCELLED);
  // نفس سعر الموعد المعروض عند الحجز (اللقطة)، لا سعر الطبيب الخام.
  return applyAppointmentPrice(updated, await patientPriceFor(updated.id, updated.doctorId));
}

// ============================================================
// طابور العيادة اليومي
// ============================================================

// عدد المرضى الذين يُنادَون قبل إعادة نداء المريض المتأخر: التأخير الأول مريضان، وكل تأخير بعده في نفس
// الموعد 4 مرضى إضافيين — انظر latePenaltyFor في lib/queueOrder.ts. من لم يستجب لندائه لا يُشطب أبدًا.

const QUEUE_INCLUDE = {
  patient: { include: { user: { select: { phone: true } } } },
  familyMember: { select: FAMILY_MEMBER_PUBLIC_SELECT },
} as const;

function todayRangeUTC() {
  const start = algeriaTodayUTCMidnight();
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { gte: start, lte: end };
}

// المدة الذكية: تقدير مدة الجلسة القادمة اعتمادًا على متوسط آخر جلسات مكتملة صالحة
// (calledAt إلى endedAt، وليس من الوقت المجدول startTime).
const SMART_DURATION_FALLBACK_MINUTES = 20;
const SMART_DURATION_MIN_SAMPLES = 3;
const SMART_DURATION_SAMPLE_SIZE = 10;
const SMART_DURATION_MIN_VALID_MINUTES = 2;
const SMART_DURATION_MAX_VALID_MINUTES = 90;

/**
 * متوسط مدة الجلسة مع مصدره: `isFallback=true` يعني أن البيانات غير كافية (أقل من
 * SMART_DURATION_MIN_SAMPLES جلسات صالحة) فالقيمة افتراضية ثابتة لا تقدير محسوب.
 */
export async function estimateSessionDetails(doctorId: string): Promise<{ minutes: number; samples: number; isFallback: boolean }> {
  const recent = await prisma.appointment.findMany({
    where: { doctorId, status: AppointmentStatus.COMPLETED, durationMinutes: { not: null } },
    orderBy: { endedAt: "desc" },
    take: 30,
    select: { durationMinutes: true },
  });

  const valid = recent
    .map((a) => a.durationMinutes as number)
    .filter((d) => d >= SMART_DURATION_MIN_VALID_MINUTES && d <= SMART_DURATION_MAX_VALID_MINUTES)
    .slice(0, SMART_DURATION_SAMPLE_SIZE);

  if (valid.length < SMART_DURATION_MIN_SAMPLES) {
    return { minutes: SMART_DURATION_FALLBACK_MINUTES, samples: valid.length, isFallback: true };
  }

  const avg = valid.reduce((sum, d) => sum + d, 0) / valid.length;
  return { minutes: Math.round(avg), samples: valid.length, isFallback: false };
}

export async function estimateSessionMinutes(doctorId: string): Promise<number> {
  return (await estimateSessionDetails(doctorId)).minutes;
}

// doctorUserId هنا هو userId للحساب الحالي (طبيب أو مساعد) — resolveActingDoctorId يحل
// الطبيب الفعلي في الحالتين (ويرفض مساعدًا معطَّلًا فورًا). نُبقي الاسم `doctor.id` في
// نقاط الاستدعاء أدناه بلا تغيير لتقليل الفرق (diff) عن الكود الأصلي.
async function requireDoctor(doctorUserId: string, role: Role) {
  const doctorId = await resolveActingDoctorId(doctorUserId, role);
  return { id: doctorId };
}

/**
 * حالة طابور اليوم كما يراها الطبيب: المريض الجالس أمامه الآن، ثم المنتظرون بالترتيب،
 * ثم قائمة المتأخرين مع عدد المناداتات المتبقية قبل عودة دور كل واحد منهم.
 */
export async function getQueueForDoctor(doctorUserId: string, role: Role) {
  const doctor = await requireDoctor(doctorUserId, role);
  return queueReads(`${doctor.id}:${algeriaTodayUTCMidnight().toISOString()}:${liveUpdates.current()}`, () => readDoctorQueue(doctor.id));
}

const queueReads = singleFlight<Awaited<ReturnType<typeof readDoctorQueue>>>();

async function readDoctorQueue(doctorId: string) {
  await autoExpireStaleAppointments(doctorId);

  const today = todayRangeUTC();
  const [appointments, sessionEstimate, todayByStatus, duty] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        doctorId,
        OR: [{ date: today, status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.LATE] } }, { status: AppointmentStatus.IN_PROGRESS }],
      },
      include: QUEUE_INCLUDE,
      orderBy: [{ startTime: "asc" }],
    }),
    estimateSessionDetails(doctorId),
    // ملخص مواعيد اليوم حسب الحالة — لتمييز الحالة الفارغة: لا مواعيد اليوم / لا منتظرين / اكتملت المواعيد.
    prisma.appointment.groupBy({ by: ["status"], where: { doctorId, date: today }, _count: { _all: true } }),
    prisma.doctor.findUniqueOrThrow({ where: { id: doctorId }, select: { queueRequestedAt: true, dutyEndsAt: true } }),
  ]);
  const countOf = (st: AppointmentStatus) => todayByStatus.find((r) => r.status === st)?._count._all ?? 0;
  const todaySummary = {
    total: todayByStatus.reduce((n, r) => n + r._count._all, 0),
    completed: countOf(AppointmentStatus.COMPLETED),
    noShow: countOf(AppointmentStatus.NO_SHOW),
    cancelled: countOf(AppointmentStatus.CANCELLED),
    pending: countOf(AppointmentStatus.PENDING),
    rescheduleRequired: countOf(AppointmentStatus.RESCHEDULE_REQUIRED),
  };

  // ordered: الترتيب الفعلي المتوقع للمناداة (المنتظرون والمتأخرون معًا) بنفس قواعد callNextPatient —
  // حقل إضافي، والحقول السابقة (waiting/late) باقية كما هي لأي واجهة قديمة.
  const ordered = presentQueueOrder(
    appointments.filter((a) => a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.LATE)
  ).map((a, i) => ({ ...a, position: i + 1 }));

  return {
    awaitingAssistant: !!duty.queueRequestedAt && !!duty.dutyEndsAt && duty.dutyEndsAt > new Date(),
    date: algeriaTodayUTCMidnight().toISOString().slice(0, 10),
    current: appointments.find((a) => a.status === AppointmentStatus.IN_PROGRESS) ?? null,
    waiting: appointments.filter((a) => a.status === AppointmentStatus.CONFIRMED),
    late: appointments.filter((a) => a.status === AppointmentStatus.LATE),
    ordered,
    // متوسط مدة الجلسة (من calledAt إلى endedAt لآخر الجلسات المكتملة)، وليس وقت انتظار مريض بعينه.
    // estimatedDurationIsFallback=true: قيمة افتراضية لعدم كفاية البيانات — لا تُعرض كتقدير محسوب.
    estimatedDurationMinutes: sessionEstimate.minutes,
    estimatedDurationIsFallback: sessionEstimate.isFallback,
    estimatedDurationSamples: sessionEstimate.samples,
    todaySummary,
  };
}

/**
 * مناداة المريض التالي.
 *
 * الترتيب زمني حسب وقت الموعد، مع استثناء واحد: المتأخر لا يُنادى إلا بعد استهلاك
 * رصيد التخطي الخاص به (skipCredits) — أي بعد مناداة مريضين. مع كل مناداة ناجحة نُنقص
 * رصيد كل المتأخرين بواحد، فيعود دور المتأخر تلقائيًا دون أي تدخل من الطبيب.
 *
 * نرفض المناداة إن كان هناك مريض بالداخل فعلًا، حتى لا تضيع حالته بصمت: على الطبيب أن
 * ينهي موعده أو يسجّله متأخرًا أولًا.
 */
export async function callNextPatient(doctorUserId: string, role: Role) {
  const doctor = await requireDoctor(doctorUserId, role);
  if (role === Role.ASSISTANT) throw ApiError.forbidden("تأكيد الإدخال يتم من زر المريض بعد طلب الطبيب.");
  return prisma.$transaction(async tx => {
    await lockDoctorCalls(tx, doctor.id);
    const profile = await tx.doctor.findUniqueOrThrow({ where: { id: doctor.id } });
    if (!profile.dutyEndsAt || profile.dutyEndsAt <= new Date()) throw ApiError.badRequest("ابدأ المداومة أولًا.");
    if (await tx.appointment.findFirst({ where: { doctorId: doctor.id, status: AppointmentStatus.IN_PROGRESS } }))
      throw ApiError.conflict("هناك مريض بالداخل الآن.");
    if (await hasOnDutyAssistant(doctor.id, tx)) {
      await tx.doctor.update({ where: { id: doctor.id }, data: { queueRequestedAt: profile.queueRequestedAt ?? new Date() } });
      return { awaitingAssistant: true };
    }
    const rows = await tx.appointment.findMany({ where: { doctorId: doctor.id, date: todayRangeUTC(), status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.LATE] } } });
    const next = firstPresent(rows);
    if (!next) throw ApiError.badRequest("لا يوجد مريض حاضر. سجّل الحضور أولًا.");
    const called = await tx.appointment.update({ where: { id: next.id }, data: { status: AppointmentStatus.IN_PROGRESS, calledAt: new Date(), callCount: { increment: 1 }, skipCredits: 0 }, include: QUEUE_INCLUDE });
    await tx.doctor.update({ where: { id: doctor.id }, data: { queueRequestedAt: null } });
    await writeAudit({ userId: doctorUserId, action: "PATIENT_ADMITTED", entity: "Appointment", entityId: next.id }, tx);
    return called;
  }, { maxWait: 10000, timeout: 15000 });
}

/**
 * تسجيل المريض كـ"متأخر" لعدم استجابته للنداء: لا يُشطب ولا يُحسب غيابًا، بل يُوضع في
 * قائمة المتأخرين برصيد تخطٍّ قدره مريضان، ويعود دوره بعدهما تلقائيًا. لا حد لعدد مرات
 * التأجيل — من بقي متأخرًا حتى إغلاق العيادة يتحوّل وحده إلى "لم يحضر".
 */
export async function markAsLate(doctorUserId: string, appointmentId: string, role: Role) {
  const doctor = await requireDoctor(doctorUserId, role);

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw ApiError.notFound("الموعد غير موجود.");
  if (appointment.doctorId !== doctor.id) throw ApiError.forbidden();

  const allowed: AppointmentStatus[] = [AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS, AppointmentStatus.LATE];
  if (!allowed.includes(appointment.status)) {
    throw ApiError.badRequest("لا يمكن تسجيل هذا الموعد كمتأخر في حالته الحالية.");
  }

  // متأخر أصلًا ولم يُنادَ من جديد: ضغطة ثانية/إعادة تحميل/نافذة «لم يحضر» على متأخر — لا تأخير جديد،
  // لا عقوبة إضافية ولا إشعار. (كان هذا يعيد الرصيد ويزيد العدّاد فيُحتسب التأخير نفسه مرتين.)
  if (appointment.status === AppointmentStatus.LATE) {
    const current = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: QUEUE_INCLUDE });
    return { ...current!, duplicate: true, lateEvent: null };
  }

  // حدث تأخير جديد: رقمه في هذا الموعد = العدّاد الحالي + 1 (العدّاد مرتبط بالموعد، فيبدأ من صفر في كل موعد).
  const sequence = appointment.deferredCount + 1;
  const penalty = latePenaltyFor(sequence);

  let result: { appointment: Awaited<ReturnType<typeof loadQueueAppointment>>; event: { id: string } } | null = null;
  try {
    result = await prisma.$transaction(async (tx) => {
      await lockDoctorCalls(tx, doctor.id);
      await assertReception(doctorUserId, role, doctor.id, tx);
      // compare-and-swap: نكتب فقط إن لم تتغير الحالة ولا العدّاد منذ القراءة. طلبان متزامنان لنفس
      // الموعد: واحد فقط يجد count = 1، والآخر يُعامَل كتكرار. القيد الفريد (appointmentId, sequence)
      // على جدول الأحداث حاجز ثانٍ على مستوى قاعدة البيانات.
      const swapped = await tx.appointment.updateMany({
        where: { id: appointmentId, status: appointment.status, deferredCount: appointment.deferredCount },
        data: { status: AppointmentStatus.LATE, skipCredits: penalty, deferredCount: sequence, arrivedAt: null },
      });
      if (swapped.count !== 1) return null;
      const event = await tx.appointmentLateEvent.create({
        data: { appointmentId, sequence, penalty, actorUserId: doctorUserId },
        select: { id: true },
      });
      return { appointment: await loadQueueAppointment(appointmentId, tx), event };
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }

  if (!result) {
    // خسر السباق أمام طلب مماثل: النتيجة هي ما سجّله الطلب الفائز، بلا أي أثر إضافي.
    const current = await loadQueueAppointment(appointmentId);
    if (current?.status === AppointmentStatus.LATE) return { ...current, duplicate: true, lateEvent: null };
    throw ApiError.conflict("تغيّرت حالة الموعد للتو. حدّث الصفحة وأعد المحاولة.");
  }

  // إشعار المريض صاحب الحساب فقط (Appointment → Patient → أجهزته). بعد نجاح المعاملة وبمعزل عنها:
  // فشل الإشعار لا يُلغي تسجيل التأخير أبدًا. الضيف بلا حساب لا يملك اشتراك Push.
  const patientUserId = result.appointment?.patient?.userId;
  if (patientUserId) {
    try {
      await createNotification(
        patientUserId,
        "APPOINTMENT_LATE",
        "🔔 تنبيه بخصوص موعدك",
        "تم تجاوز دورك مؤقتًا لأنك لم تكن حاضرًا عند المناداة. توجّه إلى العيادة، ما زلت في قائمة الانتظار.",
        `/account?appointment=${appointmentId}`,
        appointmentNotificationTag(appointmentId),
        { id: appointmentId, date: result.appointment!.date }
      );
    } catch (err) {
      console.error("تعذّر إشعار المريض بالتأخير (التأخير مسجَّل):", safeErrorCode(err));
    }
  }

  return { ...result.appointment!, duplicate: false, lateEvent: { id: result.event.id, sequence, penalty } };
}

function loadQueueAppointment(id: string, db: Prisma.TransactionClient = prisma) {
  return db.appointment.findUnique({ where: { id }, include: QUEUE_INCLUDE });
}

/**
 * مناداة مريض بعينه فورًا — للحالة الواقعية: متأخر عاد إلى الباب قبل انتهاء رصيد
 * تخطّيه، فلا معنى لإجباره على انتظار مريضين وهو واقف أمام الطبيب. نفس شرط السلامة:
 * لا نستبدل مريضًا جالسًا بالداخل بصمت.
 */
export async function callSpecificPatient(doctorUserId: string, appointmentId: string, role: Role) {
  const doctor = await requireDoctor(doctorUserId, role);
  return prisma.$transaction(async tx => {
    await lockDoctorCalls(tx, doctor.id);
    await assertReception(doctorUserId, role, doctor.id, tx);
    const profile = await tx.doctor.findUniqueOrThrow({ where: { id: doctor.id } });
    if (!profile.dutyEndsAt || profile.dutyEndsAt <= new Date()) throw ApiError.badRequest("الطبيب خارج المداومة.");
    if (role === Role.ASSISTANT && !profile.queueRequestedAt) throw ApiError.badRequest("انتظر طلب الطبيب للمريض التالي.");
    if (await tx.appointment.findFirst({ where: { doctorId: doctor.id, status: AppointmentStatus.IN_PROGRESS } })) throw ApiError.conflict("هناك مريض بالداخل الآن.");
    const rows = await tx.appointment.findMany({ where: { doctorId: doctor.id, date: todayRangeUTC(), status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.LATE] } } });
    const next = firstPresent(rows);
    if (!next || next.id !== appointmentId) throw ApiError.conflict("يجب إدخال أول مريض حاضر حسب وقت الموعد. حدّث القائمة.");
    const called = await tx.appointment.update({ where: { id: next.id }, data: { status: AppointmentStatus.IN_PROGRESS, calledAt: new Date(), callCount: { increment: 1 }, skipCredits: 0 }, include: QUEUE_INCLUDE });
    await tx.doctor.update({ where: { id: doctor.id }, data: { queueRequestedAt: null } });
    await writeAudit({ userId: doctorUserId, action: "PATIENT_ADMITTED", entity: "Appointment", entityId: next.id }, tx);
    return called;
  }, { maxWait: 10000, timeout: 15000 });
}

/**
 * تسجيل وصول المريض فعليًا إلى العيادة (اختياري، من الاستقبال أو الطبيب) — منفصل عن
 * المناداة إلى الداخل (calledAt). لا يغيّر حالة الموعد، فقط يُثبّت وقت الوصول.
 */
export async function markPatientArrived(doctorUserId: string, appointmentId: string, role: Role) {
  const doctor = await requireDoctor(doctorUserId, role);
  return prisma.$transaction(async tx => {
    await lockDoctorCalls(tx, doctor.id);
    await assertReception(doctorUserId, role, doctor.id, tx);
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment || appointment.doctorId !== doctor.id) throw ApiError.notFound("الموعد غير موجود.");
    if (appointment.date.toISOString().slice(0,10) !== algeriaTodayUTCMidnight().toISOString().slice(0,10)) throw ApiError.badRequest("الحضور لمواعيد اليوم فقط.");
    if (![AppointmentStatus.CONFIRMED, AppointmentStatus.LATE].includes(appointment.status as any)) throw ApiError.badRequest("لا يمكن تسجيل الحضور في هذه الحالة.");
    const updated = await tx.appointment.update({ where: { id: appointmentId }, data: { arrivedAt: appointment.arrivedAt ?? new Date(), skipCredits: 0 }, include: QUEUE_INCLUDE });
    if (!appointment.arrivedAt) await writeAudit({ userId: doctorUserId, action: "PATIENT_ARRIVED", entity: "Appointment", entityId: appointmentId }, tx);
    return updated;
  });
}
