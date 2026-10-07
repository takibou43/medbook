import { AppointmentStatus, Prisma, Role, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { algeriaTodayUTCMidnight, generateAvailableSlots, isPast } from "../../lib/slots";
import {
  reserveRequestedOrNextSlot,
  reserveExactSlot,
  slotMinutesFor,
  AssignedSlot,
  NoSlotAvailableError,
  SlotRaceExhaustedError,
  ExactSlotUnavailableError,
} from "../../lib/slotAssign";
import { DoctorQueueBusyError } from "../../lib/doctorLock";
import { resolveActingDoctorId } from "../../lib/actingDoctor";
import { assistantDoctorContext } from "../../lib/assistantDoctorContext";
import { assistantDoctorWhere } from "../../lib/assistantScope";
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
 *  - الوقت: اليوم فقط. startTime اختياري:
 *      · محدد ⇒ ذلك الوقت بالضبط (reserveExactSlot). خارج الدوام/الشبكة ⇒ 400، مضى ⇒ 400، محجوز ⇒ 409 SLOT_TAKEN.
 *        لا يُنقل المريض إلى وقت آخر بصمت.
 *      · غير محدد ⇒ أقرب فترة حرة لم يمضِ وقتها (reserveRequestedOrNextSlot).
 *    كلاهما تحت قفل طابور الطبيب + القيد الفريد (doctorId, date, startTime, activeSlot).
 *  - CONFIRMED مع arrivedAt = الآن: المريض موجود فعلًا في العيادة.
 *  - notes = «سُجّل بواسطة المساعد» دائمًا، تتبعها ملاحظات المساعد إن وُجدت.
 *  - idempotencyKey (فريد لكل طبيب، القيد موجود مسبقًا): إعادة نفس الطلب تعيد نفس الموعد ولا تنشئ ثانيًا.
 *    «نفس الطلب» = نفس المساعد والاسم والهاتف والملاحظات، ونفس الوقت إن حُدِّد. أي اختلاف ⇒ 409.
 *  - لا إشعار ولا SMS ولا Push لأي طرف.
 *  - createdBy = GUEST (المريض بلا حساب) و createdByUserId = حساب المساعد؛ مع سطر AuditLog
 *    WALK_IN_APPOINTMENT_CREATED. (قيمة ASSISTANT في enum تتطلب migration، وهي خارج النطاق.)
 *  - الاستجابة بلا أي بيانات مالية (نسبة الطبيب لا تصل إلى المساعد).
 */

export const WALK_IN_NOTE = "سُجّل بواسطة المساعد";

export const WALK_IN_SELECT = {
  id: true,
  doctorId: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  type: true,
  arrivedAt: true,
  notes: true,
  guestFirstName: true,
  guestLastName: true,
  guestPhone: true,
  patientId: true,
  createdBy: true,
  createdByUserId: true,
  createdAt: true,
} satisfies Prisma.AppointmentSelect;

type WalkInRow = Prisma.AppointmentGetPayload<{ select: typeof WALK_IN_SELECT }>;

export const NO_SLOT_TODAY_MESSAGE = "لا يوجد وقت شاغر اليوم ضمن أوقات عمل الطبيب. لم يُسجَّل المريض.";
const KEY_REUSED_MESSAGE = "مفتاح الطلب مستعمل لتسجيل آخر. أعد فتح النافذة وحاول مجددًا.";
export const slotTakenMessage = (t: string) => `الوقت ${t} محجوز. اختر وقتًا آخر من الأوقات المتاحة اليوم. لم يُسجَّل المريض.`;

/** الملاحظة المحفوظة: العبارة الثابتة دائمًا، ثم ملاحظات المساعد كما أدخلها. */
export function walkInNotes(notes?: string): string {
  const extra = notes?.trim();
  return extra ? `${WALK_IN_NOTE} — ${extra}` : WALK_IN_NOTE;
}

function view(row: WalkInRow) {
  // createdByUserId للتدقيق فقط — لا نعيده.
  const { createdByUserId: _by, ...rest } = row;
  return rest;
}

/** نفس الطلب = نفس المساعد والهاتف والاسم والملاحظات، ونفس الوقت إن حُدِّد. غير ذلك: المفتاح أُعيد استعماله خطأً → 409. */
function sameRequest(row: WalkInRow, userId: string, input: WalkInInput) {
  return (
    row.createdByUserId === userId &&
    row.patientId === null &&
    row.guestPhone === input.phone &&
    row.guestFirstName === input.firstName &&
    row.guestLastName === input.lastName &&
    row.notes === walkInNotes(input.notes) &&
    (input.startTime === undefined || row.startTime === input.startTime)
  );
}

function replayOrConflict(row: WalkInRow, userId: string, input: WalkInInput) {
  if (!sameRequest(row, userId, input)) throw ApiError.conflict(KEY_REUSED_MESSAGE, { code: "IDEMPOTENCY_KEY_REUSED" });
  return { appointment: view(row), replayed: true };
}

async function findByKey(db: Prisma.TransactionClient, doctorId: string, key: string) {
  return db.appointment.findUnique({ where: { doctorId_idempotencyKey: { doctorId, idempotencyKey: key } }, select: WALK_IN_SELECT });
}

/**
 * مساعد عيادة مرتبط بأكثر من طبيب يجب أن يحدد الطبيب صراحةً (X-Assistant-Doctor-Id) — لا نسجّل
 * المريض بصمت عند «أول» طبيب في القائمة. الطبيب المحدد يُتحقق منه بعدها في resolveActingDoctorId
 * (ارتباطات المساعد الفعلية ∩ أعضاء العيادة النشطين ⇒ وإلا 403). هذا تضييق فقط، لا توسيع.
 */
async function requireDoctorChoiceWhenMany(userId: string) {
  if (assistantDoctorContext.getStore()) return;
  const assistant = await prisma.assistant.findUnique({ where: { userId }, select: { clinicId: true, doctorId: true, allDoctors: true, allowedDoctorIds: true, isActive: true } });
  if (!assistant?.clinicId || !assistant.isActive) return; // resolveActingDoctorId يرفض/يحل الباقي
  const count = await prisma.doctor.count({ where: assistantDoctorWhere(assistant) });
  if (count > 1) throw ApiError.badRequest("اختر الطبيب الذي سيُسجَّل له المريض.", { code: "DOCTOR_REQUIRED" });
}

export async function createWalkIn(userId: string, role: Role, input: WalkInInput) {
  // المسار محصور بالمساعد في الراوتر؛ نكرر الفحص هنا كي لا تُستدعى الخدمة من مكان آخر بدور مختلف.
  if (role !== Role.ASSISTANT) throw ApiError.forbidden();
  await requireDoctorChoiceWhenMany(userId);
  const doctorId = await resolveActingDoctorId(userId, role);

  // إعادة إرسال سريعة (نقرة مزدوجة/انقطاع شبكة) لطلب نجح: نعيده دون لمس القفل.
  const early = await findByKey(prisma, doctorId, input.idempotencyKey);
  if (early) return replayOrConflict(early, userId, input);

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
  const requested = input.startTime;
  if (requested) {
    // تحقق قبل القفل برسالة واضحة: الوقت يجب أن يكون ضمن شبكة أوقات الطبيب لليوم، ولم يمضِ.
    const grid = generateAvailableSlots(date, doctor.schedules, [], slotMinutesFor(doctor));
    if (!grid.includes(requested)) throw ApiError.badRequest(`الوقت ${requested} ليس من أوقات عمل الطبيب اليوم.`);
    if (isPast(date, requested)) throw ApiError.badRequest(`الوقت ${requested} مضى. اختر وقتًا قادمًا من أوقات اليوم.`);
  }

  const financial = await loadFinancialCreate(doctor.id);
  const notes = walkInNotes(input.notes);
  const replay: { row: WalkInRow | null } = { row: null };

  const create = async (tx: Prisma.TransactionClient, slot: AssignedSlot) => {
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
        notes,
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
        // بلا اسم ولا هاتف ولا ملاحظات (AuditLog لا يحمل بيانات شخصية).
        meta: { doctorId: doctor.id, date: date.toISOString().slice(0, 10), startTime: slot.startTime, chosenTime: !!requested, byRole: "ASSISTANT" },
      },
      tx
    );
    return row;
  };

  let created: WalkInRow;
  try {
    created = requested
      ? (await reserveExactSlot({ doctor, date, startTime: requested, create })).result
      : // نفس حساب أقرب وقت للحجز الآلي للمريض، مع احترام فترات الدوام وحجوزات اليوم النشطة.
        (await reserveRequestedOrNextSlot({ doctor, date, requestedStart: "00:00", automaticToday: true, create })).result;
  } catch (err) {
    if (err instanceof ExactSlotUnavailableError) {
      // قد يكون الوقت أخذه طلب متزامن بنفس المفتاح: نعيد ما أنشأه إن كان نفس الطلب.
      const again = await findByKey(prisma, doctor.id, input.idempotencyKey);
      if (again) return replayOrConflict(again, userId, input);
      throw ApiError.conflict(slotTakenMessage(requested!), { code: "SLOT_TAKEN" });
    }
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

  if (replay.row) return replayOrConflict(replay.row, userId, input);
  return { appointment: view(created), replayed: false };
}
