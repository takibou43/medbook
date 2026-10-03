import { loadFinancialCreate } from "../../lib/clinicFinance";
import { safeErrorCode } from "../../lib/safeError";
import { AppointmentStatus, Prisma, SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isDoctorSubscriptionActive } from "../../lib/clinicBilling";
import { ApiError } from "../../utils/ApiError";
import { algeriaTodayUTCMidnight, generateAvailableSlots, isPast } from "../../lib/slots";
import { reserveExactSlot, slotMinutesFor, ExactSlotUnavailableError } from "../../lib/slotAssign";
import { DoctorQueueBusyError } from "../../lib/doctorLock";
import { writeAudit } from "../../lib/audit";
import { beneficiaryOf, FAMILY_MEMBER_PUBLIC_SELECT } from "../../lib/beneficiary";
import { appointmentNotificationTag } from "../../lib/appointmentExpiry";
import { createNotification } from "../notifications/notifications.service";
import { getDoctorAvailability as getDoctorDaySlots } from "../doctors/doctors.service";
import { followUpNotificationText, resolveFollowUpBeneficiary, sameBeneficiary, withinFollowUpHorizon } from "./treatment.logic";
import { FollowUpAppointmentInput, RescheduleInput } from "./treatment.schema";

/**
 * «برمجة موعد عودة» — الطبيب ينشئ موعدًا فعليًا مستقلًا مرتبطًا بموعد سابق (parentAppointmentId).
 *
 * لماذا POST /api/doctor/appointments/:id/follow-up (لا /patients/:patientId/...)؟ لأن الموعد الأصلي وحده
 * يثبت علاقة الطبيب بالمريض وبالمستفيد: نقرأه بشرط doctorId = طبيب الجلسة، فلا طريقة لبرمجة موعد لمريض
 * لم يحجز عند هذا الطبيب أصلًا.
 *
 * منع التعارض والسباق: نفس آلية الحجز الموجودة (reserveExactSlot): طابور الطبيب داخل العملية + قفل
 * استشاري داخل المعاملة + القيد الفريد (doctorId, date, startTime, activeSlot) خط دفاع أخير — لا نتجاوزه.
 * الموعد الأصلي لا يُعدَّل أبدًا.
 *
 * لا SMS. إشعار داخل التطبيق إلزامي؛ createNotification يرسل معه Web Push فقط لمن فعّله مسبقًا على جهازه
 * (نفس النظام الحالي، بنص محايد بلا سبب طبي).
 */

export const SLOT_TAKEN_MESSAGE = "هذا الموعد حُجز للتو، يرجى اختيار وقت آخر.";
export const OUTSIDE_SCHEDULE_MESSAGE = "هذا الوقت خارج أوقات عمل الطبيب أو في يوم عطلة.";

async function requireBookingDoctor(userId: string) {
  const doctor = await prisma.doctor.findUnique({ where: { userId }, include: { schedules: true, user: { select: { isActive: true } } } });
  if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
  // نفس سياسة الحجز الحالية: طبيب غير موثّق أو اشتراكه غير فعّال لا يُنشأ عنده موعد جديد.
  if (doctor.verificationStatus !== VerificationStatus.VERIFIED) {
    throw ApiError.forbidden("لا يمكن برمجة مواعيد قبل توثيق حسابك من الإدارة.");
  }
  if (!(await isDoctorSubscriptionActive(doctor))) {
    throw ApiError.forbidden("اشتراكك غير فعّال حاليًا، لذلك لا يمكن إنشاء مواعيد جديدة.");
  }
  return doctor;
}

type BookingDoctor = Awaited<ReturnType<typeof requireBookingDoctor>>;

/** تحقق التاريخ/الوقت قبل القفل: الماضي، الأفق، والدوام/العطلة (بلا اعتبار للمحجوز — ذاك داخل القفل). */
function assertSlotInSchedule(doctor: BookingDoctor, dateStr: string, startTime: string): Date {
  const date = new Date(dateStr + "T00:00:00Z");
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateStr) throw ApiError.badRequest("تاريخ غير صالح.");
  if (isPast(date, startTime)) throw ApiError.badRequest("لا يمكن برمجة موعد في وقت مضى.");
  if (!withinFollowUpHorizon(date, algeriaTodayUTCMidnight())) throw ApiError.badRequest("التاريخ بعيد جدًا. اختر تاريخًا خلال السنة القادمة.");
  // شبكة أوقات الطبيب لذلك اليوم (دوام أسبوعي + استثناءات + عطل + مدة الجلسة)، بلا أي حجز.
  const grid = generateAvailableSlots(date, doctor.schedules, [], slotMinutesFor(doctor));
  if (!grid.includes(startTime)) throw ApiError.badRequest(OUTSIDE_SCHEDULE_MESSAGE);
  return date;
}

const RESULT_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  type: true,
  createdBy: true,
  parentAppointmentId: true,
  treatmentPlanId: true,
  treatmentSessionId: true,
  familyMemberId: true,
  patientId: true,
  guestFirstName: true,
  guestLastName: true,
  familyMember: { select: FAMILY_MEMBER_PUBLIC_SELECT },
} satisfies Prisma.AppointmentSelect;

type ResultRow = Prisma.AppointmentGetPayload<{ select: typeof RESULT_SELECT }>;

function view(a: ResultRow) {
  const { guestFirstName, guestLastName, familyMember, ...rest } = a;
  return { ...rest, beneficiary: beneficiaryOf({ familyMemberId: a.familyMemberId, familyMember, guestFirstName, guestLastName }) };
}

async function findByIdempotencyKey(doctorId: string, key: string) {
  return prisma.appointment.findUnique({ where: { doctorId_idempotencyKey: { doctorId, idempotencyKey: key } }, select: RESULT_SELECT });
}

export async function createFollowUpAppointment(userId: string, parentAppointmentId: string, input: FollowUpAppointmentInput) {
  const doctor = await requireBookingDoctor(userId);

  // إعادة إرسال نفس الطلب (نقرة مزدوجة، انقطاع شبكة): نعيد نفس الموعد ولا ننشئ ثانيًا.
  const replay = await findByIdempotencyKey(doctor.id, input.idempotencyKey);
  if (replay) {
    if (replay.parentAppointmentId !== parentAppointmentId) throw ApiError.conflict("مفتاح الطلب مستعمل لموعد آخر.");
    return { appointment: view(replay), replayed: true };
  }

  const parent = await prisma.appointment.findUnique({
    where: { id: parentAppointmentId },
    select: {
      id: true,
      doctorId: true,
      patientId: true,
      familyMemberId: true,
      status: true,
      guestPhone: true,
      patient: { select: { id: true, userId: true, firstName: true, lastName: true, user: { select: { phone: true } } } },
    },
  });
  // موعد طبيب آخر أو غير موجود → 404 (لا نكشف وجوده). حجز ضيف بلا حساب → لا يمكن ربط العودة بحساب.
  if (!parent || parent.doctorId !== doctor.id) throw ApiError.notFound("الموعد غير موجود.");
  if (!parent.patientId || !parent.patient) throw ApiError.badRequest("لا يمكن برمجة موعد عودة لحجز بدون حساب مريض.");
  if (parent.status === AppointmentStatus.CANCELLED) throw ApiError.badRequest("لا يمكن برمجة موعد عودة انطلاقًا من موعد ملغى.");

  // المستفيد: نفس مستفيد الموعد الأصلي ما لم يُختر غيره صراحةً — وأي فرد يجب أن يكون من عائلة نفس صاحب الحساب.
  const familyMemberId = resolveFollowUpBeneficiary(parent.familyMemberId, input.familyMemberId);
  let member: { id: string; firstName: string; lastName: string } | null = null;
  if (familyMemberId) {
    member = await prisma.familyMember.findFirst({
      where: { id: familyMemberId, ownerPatientId: parent.patientId, archivedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!member) throw ApiError.forbidden("فرد العائلة لا ينتمي إلى حساب هذا المريض.");
  }

  // الربط بخطة علاج (اختياري): خطة هذا الطبيب، لنفس صاحب الحساب ونفس المستفيد، وغير ملغاة.
  let planId: string | null = null;
  if (input.treatmentPlanId || input.treatmentSessionId || input.dentalFollowUpId) {
    if (!input.treatmentPlanId) throw ApiError.badRequest("حدّد خطة العلاج المرتبطة.");
    const plan = await prisma.dentalTreatmentPlan.findFirst({
      where: { id: input.treatmentPlanId, doctorId: doctor.id },
      select: { id: true, patientId: true, familyMemberId: true, status: true },
    });
    if (!plan) throw ApiError.notFound("خطة العلاج غير موجودة.");
    if (plan.status === "CANCELLED") throw ApiError.badRequest("لا يمكن ربط موعد بخطة ملغاة.");
    if (plan.patientId !== parent.patientId || !sameBeneficiary(plan.familyMemberId, familyMemberId)) {
      throw ApiError.badRequest("خطة العلاج تخص مريضًا أو مستفيدًا مختلفًا.");
    }
    if (input.treatmentSessionId) {
      const s = await prisma.dentalTreatmentSession.findFirst({ where: { id: input.treatmentSessionId, treatmentPlanId: plan.id }, select: { id: true } });
      if (!s) throw ApiError.badRequest("الجلسة لا تنتمي إلى هذه الخطة.");
    }
    if (input.dentalFollowUpId) {
      const f = await prisma.dentalFollowUp.findFirst({ where: { id: input.dentalFollowUpId, treatmentPlanId: plan.id }, select: { status: true } });
      if (!f) throw ApiError.badRequest("المتابعة لا تنتمي إلى هذه الخطة.");
      if (f.status !== "DUE") throw ApiError.conflict("هذه المتابعة ليست مستحقة (مبرمجة أو مغلقة مسبقًا).");
    }
    planId = plan.id;
  }

  const date = assertSlotInSchedule(doctor, input.date, input.startTime);
  const financial = await loadFinancialCreate(doctor.id);
  const beneficiaryFirst = member ? member.firstName : parent.patient.firstName;
  const beneficiaryLast = member ? member.lastName : parent.patient.lastName;

  let created: ResultRow;
  try {
    created = (
      await reserveExactSlot({
        doctor,
        date,
        startTime: input.startTime,
        create: async (tx, slot) => {
          const row = await tx.appointment.create({
            data: {
              financial,
              doctorId: doctor.id,
              patientId: parent.patientId,
              familyMemberId,
              // الاسم الظاهر في لوحة الطبيب والطابور = المستفيد؛ الهاتف = هاتف صاحب الحساب (لا هاتف لكل فرد).
              guestFirstName: beneficiaryFirst,
              guestLastName: beneficiaryLast,
              guestPhone: parent.patient!.user.phone ?? parent.guestPhone ?? null,
              date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              type: "FOLLOW_UP",
              // الطبيب هو من أنشأه: مؤكَّد مباشرة.
              status: AppointmentStatus.CONFIRMED,
              notes: input.notes ?? null,
              parentAppointmentId: parent.id,
              treatmentPlanId: planId,
              treatmentSessionId: input.treatmentSessionId ?? null,
              createdBy: "DOCTOR",
              createdByUserId: userId,
              idempotencyKey: input.idempotencyKey,
            },
            select: RESULT_SELECT,
          });
          // تحويل متابعة الخطة المستحقة إلى موعد حقيقي (SCHEDULED، لا COMPLETED) — ذرّيًا مع الإنشاء.
          if (input.dentalFollowUpId) {
            const r = await tx.dentalFollowUp.updateMany({
              where: { id: input.dentalFollowUpId, status: "DUE" },
              data: { status: "SCHEDULED", appointmentId: row.id },
            });
            if (r.count !== 1) throw ApiError.conflict("تغيّرت حالة هذه المتابعة للتو. حدّث الصفحة وأعد المحاولة.");
          }
          // جلسة مخطَّطة بلا موعد: هذا الموعد يحققها.
          if (input.treatmentSessionId) {
            await tx.dentalTreatmentSession.updateMany({
              where: { id: input.treatmentSessionId, appointmentId: null, status: "PLANNED" },
              data: { appointmentId: row.id },
            });
          }
          await writeAudit(
            {
              userId,
              action: "FOLLOW_UP_APPOINTMENT_CREATED",
              entity: "Appointment",
              entityId: row.id,
              meta: { parentAppointmentId: parent.id, date: input.date, startTime: slot.startTime, treatmentPlanId: planId },
            },
            tx
          );
          return row;
        },
      })
    ).result;
  } catch (err) {
    if (err instanceof ExactSlotUnavailableError) {
      // خسر سباقًا — قد يكون أمام نفس الطلب المكرر (نفس المفتاح): نعيد ما أنشأه الطلب الفائز.
      const again = await findByIdempotencyKey(doctor.id, input.idempotencyKey);
      if (again) {
        if (again.parentAppointmentId !== parentAppointmentId) throw ApiError.conflict("مفتاح الطلب مستعمل لموعد آخر.");
        return { appointment: view(again), replayed: true };
      }
      throw ApiError.conflict(SLOT_TAKEN_MESSAGE, { code: "SLOT_TAKEN" });
    }
    if (err instanceof DoctorQueueBusyError) {
      throw ApiError.unavailable("الازدحام مرتفع الآن. لم يُسجَّل أي موعد، الرجاء المحاولة بعد لحظات.");
    }
    throw err;
  }

  // إشعار داخل التطبيق لصاحب الحساب (إلزامي) — بعد نجاح المعاملة، وفشله لا يلغي الموعد المحفوظ.
  try {
    await createNotification(
      parent.patient.userId,
      "APPOINTMENT_FOLLOW_UP_SCHEDULED",
      "موعد عودة جديد",
      followUpNotificationText({
        doctorName: `${doctor.firstName} ${doctor.lastName}`,
        date: input.date,
        startTime: created.startTime,
        beneficiaryName: member ? `${member.firstName} ${member.lastName}` : null,
      }),
      `/account?appointment=${created.id}`,
      appointmentNotificationTag(created.id),
      { id: created.id, date: created.date }
    );
  } catch (err) {
    console.error("تعذّر إنشاء إشعار موعد العودة (الموعد محفوظ):", safeErrorCode(err));
  }

  return { appointment: view(created), replayed: false };
}

/**
 * إعادة جدولة موعد عودة برمجه الطبيب نفسه (نفس الصف، تاريخ/وقت جديد) تحت نفس القفل والقيد الفريد،
 * مع سطر AuditLog. الإلغاء يمر بالمسار الحالي PATCH /api/appointments/:id (ويُسجَّل هناك أيضًا).
 */
export async function rescheduleFollowUpAppointment(userId: string, appointmentId: string, input: RescheduleInput) {
  const doctor = await requireBookingDoctor(userId);
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, doctorId: true, createdBy: true, type: true, status: true, date: true, startTime: true, patient: { select: { userId: true } } },
  });
  if (!appt || appt.doctorId !== doctor.id) throw ApiError.notFound("الموعد غير موجود.");
  if (appt.createdBy !== "DOCTOR" || appt.type !== "FOLLOW_UP") throw ApiError.badRequest("إعادة الجدولة هنا خاصة بمواعيد العودة التي برمجتها.");
  const reschedulable: AppointmentStatus[] = [AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING, AppointmentStatus.RESCHEDULE_REQUIRED];
  if (!reschedulable.includes(appt.status)) throw ApiError.badRequest("لا يمكن إعادة جدولة هذا الموعد في حالته الحالية.");

  const date = assertSlotInSchedule(doctor, input.date, input.startTime);
  let updated: ResultRow;
  try {
    updated = (
      await reserveExactSlot({
        doctor,
        date,
        startTime: input.startTime,
        create: async (tx, slot) => {
          // compare-and-swap على الحالة والوقت القديمين: لا نكتب فوق تغيير متزامن.
          const r = await tx.appointment.updateMany({
            where: { id: appt.id, status: appt.status, date: appt.date, startTime: appt.startTime },
            data: { date, startTime: slot.startTime, endTime: slot.endTime, status: AppointmentStatus.CONFIRMED },
          });
          if (r.count !== 1) throw ApiError.conflict("تغيّر هذا الموعد للتو. حدّث الصفحة وأعد المحاولة.");
          await writeAudit(
            {
              userId,
              action: "FOLLOW_UP_APPOINTMENT_RESCHEDULED",
              entity: "Appointment",
              entityId: appt.id,
              meta: {
                from: { date: appt.date.toISOString().slice(0, 10), startTime: appt.startTime },
                to: { date: input.date, startTime: slot.startTime },
              },
            },
            tx
          );
          return tx.appointment.findUniqueOrThrow({ where: { id: appt.id }, select: RESULT_SELECT });
        },
      })
    ).result;
  } catch (err) {
    if (err instanceof ExactSlotUnavailableError) throw ApiError.conflict(SLOT_TAKEN_MESSAGE, { code: "SLOT_TAKEN" });
    if (err instanceof DoctorQueueBusyError) throw ApiError.unavailable("الازدحام مرتفع الآن. لم يُغيَّر الموعد، الرجاء المحاولة بعد لحظات.");
    throw err;
  }

  if (appt.patient?.userId) {
    try {
      await createNotification(
        appt.patient.userId,
        "APPOINTMENT_FOLLOW_UP_SCHEDULED",
        "تغيّر موعد العودة",
        `غيّر الدكتور ${doctor.firstName} ${doctor.lastName} موعد العودة إلى يوم ${input.date} على الساعة ${updated.startTime}.`,
        `/account?appointment=${updated.id}`,
        appointmentNotificationTag(updated.id),
        { id: updated.id, date: updated.date }
      );
    } catch (err) {
      console.error("تعذّر إشعار المريض بتغيير موعد العودة:", safeErrorCode(err));
    }
  }
  return view(updated);
}

/** أوقات الطبيب المتاحة ليوم معيّن (لنافذة «برمجة موعد عودة») — نفس دالة الأوقات المتاحة الموجودة. */
export async function followUpSlotsForDate(userId: string, dateStr: string) {
  const doctor = await requireBookingDoctor(userId);
  const date = new Date(dateStr + "T00:00:00Z");
  if (isNaN(date.getTime())) throw ApiError.badRequest("تاريخ غير صالح.");
  if (!withinFollowUpHorizon(date, algeriaTodayUTCMidnight())) return { date: dateStr, slotMinutes: slotMinutesFor(doctor), slots: [] as string[] };
  const { slots } = await getDoctorDaySlots(doctor.id, dateStr);
  return { date: dateStr, slotMinutes: slotMinutesFor(doctor), slots };
}
