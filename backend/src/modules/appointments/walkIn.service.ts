import { AppointmentStatus, Prisma, Role, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { algeriaTodayUTCMidnight } from "../../lib/slots";
import { reserveRequestedOrNextSlot, NoSlotAvailableError, SlotRaceExhaustedError } from "../../lib/slotAssign";
import { DoctorQueueBusyError } from "../../lib/doctorLock";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { isDoctorSubscriptionActive } from "../../lib/clinicBilling";
import { loadFinancialCreate } from "../../lib/clinicFinance";
import { writeAudit } from "../../lib/audit";
import { WalkInInput } from "./appointments.schema";

/**
 * «مريض حضر بدون موعد» — المساعد يسجّله من الاستقبال: POST /api/appointments/walk-in (للمساعد وحده).
 *
 *  - ضيف بالاسم والهاتف: patientId = null دائمًا. الاسم أو الهاتف لا يثبتان هوية حساب، فلا نبحث عن مريض
 *    بنفس الرقم ولا نربط أو ندمج أي سجل.
 *  - الطبيب = الطبيب الذي يعمل المساعد باسمه (resolveActingDoctorId: نفس فحص العيادة/التعطيل في كل الطابور).
 *  - الوقت: اليوم فقط، أول فترة شاغرة لم يمضِ وقتها ضمن دوام الطبيب — بنفس آلية الحجز (قفل طابور الطبيب +
 *    القيد الفريد (doctorId, date, startTime, activeSlot) خط دفاع أخير). لا ننتقل إلى يوم آخر.
 *  - CONFIRMED مع arrivedAt = الآن: المريض موجود فعلًا في العيادة.
 *  - idempotencyKey (فريد لكل طبيب، القيد موجود مسبقًا): إعادة نفس الطلب تعيد نفس الموعد ولا تنشئ ثانيًا.
 *    الفحص داخل القفل، فطلبان متزامنان بنفس المفتاح لا ينشئان موعدين.
 *  - لا إشعار ولا SMS ولا Push لأي طرف.
 *  - createdBy = GUEST (المريض بلا حساب) و createdByUserId = حساب المساعد؛ مع سطر AuditLog
 *    WALK_IN_APPOINTMENT_CREATED. (قيمة ASSISTANT في enum تتطلب migration، وهي خارج النطاق.)
 *  - الاستجابة بلا أي بيانات مالية (نسبة الطبيب لا تصل إلى المساعد).
 */

export const WALK_IN_SELECT = {
  id: true,
  doctorId: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  type: true,
  arrivedAt: true,
  guestFirstName: true,
  guestLastName: true,
  guestPhone: true,
  patientId: true,
  createdBy: true,
  createdByUserId: true,
  createdAt: true,
} satisfies Prisma.AppointmentSelect;

type WalkInRow = Prisma.AppointmentGetPayload<{ select: typeof WALK_IN_SELECT }>;

export const NO_SLOT_TODAY_MESSAGE =
  "لا يوجد وقت شاغر اليوم ضمن أوقات عمل الطبيب. لم يُسجَّل المريض.";
const KEY_REUSED_MESSAGE = "مفتاح الطلب مستعمل لتسجيل آخر. أعد فتح النافذة وحاول مجددًا.";

function view(row: WalkInRow) {
  // createdByUserId للتدقيق فقط — لا نعيده.
  const { createdByUserId: _by, ...rest } = row;
  return rest;
}

/** نفس الطلب = نفس المساعد ونفس الهاتف والاسم. غير ذلك: المفتاح أُعيد استعماله خطأً → 409. */
function sameRequest(row: WalkInRow, userId: string, input: WalkInInput) {
  return (
    row.createdByUserId === userId &&
    row.patientId === null &&
    row.guestPhone === input.phone &&
    row.guestFirstName === input.firstName &&
    row.guestLastName === input.lastName
  );
}

async function findByKey(db: Prisma.TransactionClient, doctorId: string, key: string) {
  return db.appointment.findUnique({ where: { doctorId_idempotencyKey: { doctorId, idempotencyKey: key } }, select: WALK_IN_SELECT });
}

export async function createWalkIn(userId: string, role: Role, input: WalkInInput) {
  // المسار محصور بالمساعد في الراوتر؛ نكرر الفحص هنا كي لا تُستدعى الخدمة من مكان آخر بدور مختلف.
  if (role !== Role.ASSISTANT) throw ApiError.forbidden();
  const doctorId = await resolveActingDoctorId(userId, role);

  // إعادة إرسال سريعة (نقرة مزدوجة/انقطاع شبكة) لطلب نجح: نعيده دون لمس القفل.
  const early = await findByKey(prisma, doctorId, input.idempotencyKey);
  if (early) {
    if (!sameRequest(early, userId, input)) throw ApiError.conflict(KEY_REUSED_MESSAGE, { code: "IDEMPOTENCY_KEY_REUSED" });
    return { appointment: view(early), replayed: true };
  }

  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: { schedules: true, user: { select: { isActive: true } } },
  });
  if (!doctor) throw ApiError.notFound("الطبيب غير موجود.");
  // نفس سياسة إنشاء المواعيد: طبيب غير موثّق أو اشتراكه غير فعّال لا يُنشأ عنده موعد جديد.
  if (doctor.verificationStatus !== VerificationStatus.VERIFIED) {
    throw ApiError.forbidden("لا يمكن تسجيل مرضى قبل توثيق حساب الطبيب من الإدارة.");
  }
  if (!(await isDoctorSubscriptionActive(doctor))) {
    throw ApiError.forbidden("اشتراك الطبيب غير فعّال حاليًا، لذلك لا يمكن تسجيل مرضى جدد.");
  }

  const date = algeriaTodayUTCMidnight();
  const financial = await loadFinancialCreate(doctor.id);
  const replay: { row: WalkInRow | null } = { row: null };

  let created: WalkInRow;
  try {
    created = (
      await reserveRequestedOrNextSlot({
        doctor,
        date,
        // «00:00» = أول فترة شاغرة لم يمضِ وقتها (firstFreeSlotAtOrAfter يتخطى الماضي).
        requestedStart: "00:00",
        create: async (tx, slot) => {
          // تحت قفل طابور الطبيب: طلب متزامن بنفس المفتاح سبقنا → نعيد ما أنشأه.
          const existing = await findByKey(tx, doctor.id, input.idempotencyKey);
          if (existing) {
            replay.row = existing;
            return existing;
          }
          const row = await tx.appointment.create({
            data: {
              financial,
              doctorId: doctor.id,
              patientId: null,
              familyMemberId: null,
              guestFirstName: input.firstName,
              guestLastName: input.lastName,
              guestPhone: input.phone,
              date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              type: "IN_PERSON",
              status: AppointmentStatus.CONFIRMED,
              arrivedAt: new Date(),
              notes: input.notes || null,
              createdBy: "GUEST",
              createdByUserId: userId,
              idempotencyKey: input.idempotencyKey,
            },
            select: WALK_IN_SELECT,
          });
          await writeAudit(
            {
              userId,
              action: "WALK_IN_APPOINTMENT_CREATED",
              entity: "Appointment",
              entityId: row.id,
              // بلا اسم ولا هاتف (AuditLog لا يحمل بيانات شخصية).
              meta: { doctorId: doctor.id, date: date.toISOString().slice(0, 10), startTime: slot.startTime, byRole: "ASSISTANT" },
            },
            tx
          );
          return row;
        },
      })
    ).result;
  } catch (err) {
    if (err instanceof NoSlotAvailableError) throw ApiError.conflict(NO_SLOT_TODAY_MESSAGE, { code: "NO_SLOT_TODAY" });
    if (err instanceof SlotRaceExhaustedError) {
      const again = await findByKey(prisma, doctor.id, input.idempotencyKey);
      if (again && sameRequest(again, userId, input)) return { appointment: view(again), replayed: true };
      throw ApiError.conflict("تعذّر حجز وقت الآن بسبب ضغط على المواعيد. لم يُسجَّل المريض، أعد المحاولة.");
    }
    if (err instanceof DoctorQueueBusyError) {
      throw ApiError.unavailable("الازدحام مرتفع الآن. لم يُسجَّل المريض، الرجاء المحاولة بعد لحظات.");
    }
    throw err;
  }

  if (replay.row) {
    if (!sameRequest(replay.row, userId, input)) throw ApiError.conflict(KEY_REUSED_MESSAGE, { code: "IDEMPOTENCY_KEY_REUSED" });
    return { appointment: view(replay.row), replayed: true };
  }
  return { appointment: view(created), replayed: false };
}
