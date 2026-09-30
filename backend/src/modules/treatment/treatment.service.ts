import { AppointmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { isDentalSpecialty, NOT_DENTAL_MESSAGE } from "../../lib/dentalSpecialty";
import { algeriaTodayUTCMidnight } from "../../lib/slots";
import { beneficiaryOf, FAMILY_MEMBER_PUBLIC_SELECT } from "../../lib/beneficiary";
import { requirePatientIdForUser } from "../family/family.service";
import { addCalendarMonths, canTransitionPlan, sameBeneficiary } from "./treatment.logic";
import {
  CreatePlanInput,
  UpdatePlanInput,
  CreateSessionInput,
  UpdateSessionInput,
  CreateFollowUpInput,
  UpdateFollowUpInput,
} from "./treatment.schema";

/**
 * خطط علاج الأسنان متعددة الجلسات.
 *
 * الصلاحيات (كلها في الخادم):
 *  - الطبيب: doctorId من الجلسة فقط (userId → Doctor) ودور DOCTOR (المساعد مرفوض في المسارات).
 *    يجب أن يكون تخصصه طب أسنان (isDentalSpecialty) لإنشاء أو تعديل أي خطة.
 *    كل خطة تُقرأ بشرط doctorId = طبيب الجلسة؛ خطة طبيب آخر → 404 (لا نكشف وجودها).
 *    لا ينشئ خطة إلا لمريض سبق أن حجز عنده (موعد غير ملغى)، أو لأحد أفراد عائلة ذلك المريض.
 *  - المريض: يقرأ خططه وخطط أفراد عائلته فقط (patientId = صاحب الجلسة)، بلا أي تعديل،
 *    وبلا ملاحظات الطبيب الداخلية على الجلسات (notes).
 *  - لا SMS ولا Push تلقائي من هذه الوحدة؛ المتابعات تظهر داخل اللوحتين فقط.
 */

const PLAN_NOT_FOUND = "خطة العلاج غير موجودة.";

export async function requireDentalDoctor(userId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
    select: { id: true, userId: true, firstName: true, lastName: true, specialty: { select: { nameAr: true, nameFr: true } } },
  });
  if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
  if (!isDentalSpecialty(doctor.specialty)) throw ApiError.forbidden(NOT_DENTAL_MESSAGE);
  return doctor;
}

/** هل تعامل هذا الطبيب مع هذا المريض (صاحب الحساب) من قبل؟ = موعد واحد على الأقل غير ملغى. */
export async function hasTreatedPatient(doctorId: string, patientId: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  const a = await db.appointment.findFirst({
    where: { doctorId, patientId, status: { not: AppointmentStatus.CANCELLED } },
    select: { id: true },
  });
  return Boolean(a);
}

async function assertPlanSubject(doctorId: string, patientId: string, familyMemberId: string | null) {
  if (!(await hasTreatedPatient(doctorId, patientId))) {
    // نفس الرسالة سواء كان المريض غير موجود أو لم يتعامل مع الطبيب — لا نكشف وجود حسابات الآخرين.
    throw ApiError.forbidden("لا يمكنك إنشاء خطة إلا لمريض سبق أن حجز لديك.");
  }
  if (familyMemberId) {
    const member = await prisma.familyMember.findFirst({
      where: { id: familyMemberId, ownerPatientId: patientId, archivedAt: null },
      select: { id: true },
    });
    if (!member) throw ApiError.forbidden("فرد العائلة لا ينتمي إلى حساب هذا المريض.");
  }
}

const PLAN_LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  estimatedSessions: true,
  estimatedTotalCost: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  patientId: true,
  familyMemberId: true,
  patient: { select: { firstName: true, lastName: true } },
  familyMember: { select: FAMILY_MEMBER_PUBLIC_SELECT },
  _count: { select: { sessions: true } },
  sessions: { where: { status: "COMPLETED" as const }, select: { id: true } },
  followUps: {
    where: { status: { in: ["DUE" as const, "SCHEDULED" as const] } },
    select: { id: true, dueDate: true, status: true },
    orderBy: { dueDate: "asc" as const },
    take: 1,
  },
} satisfies Prisma.DentalTreatmentPlanSelect;

function planListView(p: Prisma.DentalTreatmentPlanGetPayload<{ select: typeof PLAN_LIST_SELECT }>) {
  const { sessions, _count, followUps, patient, familyMember, ...rest } = p;
  return {
    ...rest,
    beneficiary: beneficiaryOf({ familyMemberId: p.familyMemberId, familyMember, patient }),
    sessionsCount: _count.sessions,
    completedSessions: sessions.length,
    nextFollowUp: followUps[0] ?? null,
  };
}

export async function listDoctorPlans(userId: string, query: { status?: "ACTIVE" | "COMPLETED" | "CANCELLED"; patientId?: string }) {
  const doctor = await requireDentalDoctor(userId);
  const plans = await prisma.dentalTreatmentPlan.findMany({
    where: { doctorId: doctor.id, ...(query.status ? { status: query.status } : {}), ...(query.patientId ? { patientId: query.patientId } : {}) },
    select: PLAN_LIST_SELECT,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return plans.map(planListView);
}

/** المرضى الذين يمكن إنشاء خطة لهم: أصحاب حسابات حجزوا عند الطبيب، مع أفراد عائلتهم غير المؤرشفين. */
export async function listPlanCandidates(userId: string) {
  const doctor = await requireDentalDoctor(userId);
  const rows = await prisma.appointment.findMany({
    where: { doctorId: doctor.id, patientId: { not: null }, status: { not: AppointmentStatus.CANCELLED } },
    select: { patientId: true },
    distinct: ["patientId"],
    take: 500,
  });
  const ids = rows.map((r) => r.patientId as string);
  if (ids.length === 0) return [];
  const patients = await prisma.patient.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      familyMembers: { where: { archivedAt: null }, select: FAMILY_MEMBER_PUBLIC_SELECT, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return patients;
}

const PLAN_DETAIL_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  familyMember: { select: FAMILY_MEMBER_PUBLIC_SELECT },
  sessions: {
    orderBy: [{ sessionNumber: "asc" as const }, { createdAt: "asc" as const }],
    include: { appointment: { select: { id: true, date: true, startTime: true, status: true } } },
  },
  followUps: {
    orderBy: { dueDate: "asc" as const },
    include: { appointment: { select: { id: true, date: true, startTime: true, status: true } } },
  },
} satisfies Prisma.DentalTreatmentPlanInclude;

async function loadOwnedPlan(doctorId: string, planId: string, db: Prisma.TransactionClient = prisma) {
  const plan = await db.dentalTreatmentPlan.findFirst({ where: { id: planId, doctorId }, include: PLAN_DETAIL_INCLUDE });
  if (!plan) throw ApiError.notFound(PLAN_NOT_FOUND);
  // مرجع «برمجة موعد عودة» من الخطة: آخر موعد غير ملغى لنفس المستفيد عند هذا الطبيب (يثبت العلاقة العلاجية).
  const anchor = await db.appointment.findFirst({
    where: { doctorId, patientId: plan.patientId, familyMemberId: plan.familyMemberId, status: { not: AppointmentStatus.CANCELLED } },
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
    select: { id: true },
  });
  return {
    ...plan,
    anchorAppointmentId: anchor?.id ?? null,
    beneficiary: beneficiaryOf({ familyMemberId: plan.familyMemberId, familyMember: plan.familyMember, patient: plan.patient }),
  };
}

export async function getDoctorPlan(userId: string, planId: string) {
  const doctor = await requireDentalDoctor(userId);
  return loadOwnedPlan(doctor.id, planId);
}

export async function createPlan(userId: string, input: CreatePlanInput) {
  const doctor = await requireDentalDoctor(userId);
  const familyMemberId = input.familyMemberId ?? null;
  await assertPlanSubject(doctor.id, input.patientId, familyMemberId);
  const plan = await prisma.dentalTreatmentPlan.create({
    data: {
      doctorId: doctor.id,
      patientId: input.patientId,
      familyMemberId,
      title: input.title,
      description: input.description ?? null,
      estimatedSessions: input.estimatedSessions ?? null,
      estimatedTotalCost: input.estimatedTotalCost ?? null,
    },
    select: { id: true },
  });
  return loadOwnedPlan(doctor.id, plan.id);
}

export async function updatePlan(userId: string, planId: string, input: UpdatePlanInput) {
  const doctor = await requireDentalDoctor(userId);
  const plan = await loadOwnedPlan(doctor.id, planId);
  if (plan.status !== "ACTIVE") throw ApiError.conflict("هذه الخطة مغلقة (مكتملة أو ملغاة) ولا يمكن تعديلها.");
  if (input.status && !canTransitionPlan(plan.status, input.status)) throw ApiError.badRequest("انتقال غير مسموح لحالة الخطة.");
  if (Object.keys(input).length === 0) throw ApiError.badRequest("لا توجد أي تغييرات لحفظها.");

  const now = new Date();
  // compare-and-swap على الحالة: لا يُكتب فوق خطة أُغلقت للتو من تبويب آخر.
  const r = await prisma.dentalTreatmentPlan.updateMany({
    where: { id: planId, doctorId: doctor.id, status: "ACTIVE" },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.estimatedSessions !== undefined ? { estimatedSessions: input.estimatedSessions } : {}),
      ...(input.estimatedTotalCost !== undefined ? { estimatedTotalCost: input.estimatedTotalCost } : {}),
      ...(input.status ? { status: input.status, completedAt: input.status === "COMPLETED" ? now : null } : {}),
    },
  });
  if (r.count !== 1) throw ApiError.conflict("تغيّرت حالة الخطة للتو. حدّث الصفحة وأعد المحاولة.");
  return loadOwnedPlan(doctor.id, planId);
}

/**
 * موعد يمكن ربطه بجلسة/خطة: لنفس الطبيب، ولنفس صاحب الحساب، ولنفس المستفيد (صاحب الحساب أو نفس فرد العائلة)،
 * وغير ملغى. أي اختلاف → 400 برسالة واضحة.
 */
export async function assertAppointmentMatchesPlan(
  appointmentId: string,
  plan: { doctorId: string; patientId: string; familyMemberId: string | null },
  db: Prisma.TransactionClient = prisma
) {
  const a = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, doctorId: true, patientId: true, familyMemberId: true, status: true },
  });
  if (!a || a.doctorId !== plan.doctorId) throw ApiError.badRequest("لا يمكن ربط موعد لا يخصك.");
  if (a.patientId !== plan.patientId || !sameBeneficiary(a.familyMemberId, plan.familyMemberId)) {
    throw ApiError.badRequest("هذا الموعد لمريض أو مستفيد مختلف عن صاحب الخطة.");
  }
  if (a.status === AppointmentStatus.CANCELLED) throw ApiError.badRequest("لا يمكن ربط موعد ملغى.");
  return a;
}

function isUnique(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function addSession(userId: string, planId: string, input: CreateSessionInput) {
  const doctor = await requireDentalDoctor(userId);
  try {
    await prisma.$transaction(async (tx) => {
      // قفل صف الخطة: رقمان متزامنان لا يأخذان نفس sessionNumber.
      await tx.$executeRaw`SELECT 1 FROM "dental_treatment_plans" WHERE "id" = ${planId} AND "doctorId" = ${doctor.id} FOR UPDATE`;
      const plan = await tx.dentalTreatmentPlan.findFirst({ where: { id: planId, doctorId: doctor.id } });
      if (!plan) throw ApiError.notFound(PLAN_NOT_FOUND);
      if (plan.status !== "ACTIVE") throw ApiError.conflict("لا يمكن إضافة جلسات إلى خطة مغلقة.");
      if (input.appointmentId) await assertAppointmentMatchesPlan(input.appointmentId, plan, tx);
      const last = await tx.dentalTreatmentSession.aggregate({ where: { treatmentPlanId: planId }, _max: { sessionNumber: true } });
      await tx.dentalTreatmentSession.create({
        data: {
          treatmentPlanId: planId,
          sessionNumber: (last._max.sessionNumber ?? 0) + 1,
          title: input.title,
          notes: input.notes ?? null,
          plannedDate: input.plannedDate ?? null,
          appointmentId: input.appointmentId ?? null,
        },
      });
    });
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("هذا الموعد مرتبط أصلًا بجلسة أخرى.");
    throw err;
  }
  return loadOwnedPlan(doctor.id, planId);
}

async function loadOwnedSession(doctorId: string, sessionId: string) {
  const session = await prisma.dentalTreatmentSession.findFirst({
    where: { id: sessionId, treatmentPlan: { doctorId } },
    include: { treatmentPlan: true },
  });
  if (!session) throw ApiError.notFound("الجلسة غير موجودة.");
  return session;
}

export async function updateSession(userId: string, sessionId: string, input: UpdateSessionInput) {
  const doctor = await requireDentalDoctor(userId);
  const session = await loadOwnedSession(doctor.id, sessionId);
  if (session.treatmentPlan.status !== "ACTIVE") throw ApiError.conflict("لا يمكن تعديل جلسات خطة مغلقة.");
  if (Object.keys(input).length === 0) throw ApiError.badRequest("لا توجد أي تغييرات لحفظها.");
  if (input.appointmentId) await assertAppointmentMatchesPlan(input.appointmentId, session.treatmentPlan);

  const now = new Date();
  const data: Prisma.DentalTreatmentSessionUncheckedUpdateInput = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.plannedDate !== undefined ? { plannedDate: input.plannedDate } : {}),
    ...(input.appointmentId !== undefined ? { appointmentId: input.appointmentId } : {}),
  };
  if (input.status) {
    data.status = input.status;
    data.completedAt = input.status === "COMPLETED" ? session.completedAt ?? now : null;
  }
  try {
    await prisma.dentalTreatmentSession.update({ where: { id: sessionId }, data });
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("هذا الموعد مرتبط أصلًا بجلسة أخرى.");
    throw err;
  }
  return loadOwnedPlan(doctor.id, session.treatmentPlanId);
}

/** إعادة ترتيب كل جلسات الخطة ذرّيًا. القائمة يجب أن تطابق جلسات الخطة تمامًا (لا زيادة ولا نقص). */
export async function reorderSessions(userId: string, planId: string, sessionIds: string[]) {
  const doctor = await requireDentalDoctor(userId);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "dental_treatment_plans" WHERE "id" = ${planId} AND "doctorId" = ${doctor.id} FOR UPDATE`;
    const plan = await tx.dentalTreatmentPlan.findFirst({ where: { id: planId, doctorId: doctor.id }, select: { status: true } });
    if (!plan) throw ApiError.notFound(PLAN_NOT_FOUND);
    if (plan.status !== "ACTIVE") throw ApiError.conflict("لا يمكن إعادة ترتيب جلسات خطة مغلقة.");
    const existing = await tx.dentalTreatmentSession.findMany({ where: { treatmentPlanId: planId }, select: { id: true } });
    const set = new Set(existing.map((s) => s.id));
    if (sessionIds.length !== set.size || new Set(sessionIds).size !== sessionIds.length || sessionIds.some((id) => !set.has(id))) {
      throw ApiError.badRequest("قائمة الجلسات لا تطابق جلسات هذه الخطة.");
    }
    for (let i = 0; i < sessionIds.length; i++) {
      await tx.dentalTreatmentSession.update({ where: { id: sessionIds[i] }, data: { sessionNumber: i + 1 } });
    }
  });
  return loadOwnedPlan(doctor.id, planId);
}

export async function addFollowUp(userId: string, planId: string, input: CreateFollowUpInput) {
  const doctor = await requireDentalDoctor(userId);
  const plan = await prisma.dentalTreatmentPlan.findFirst({ where: { id: planId, doctorId: doctor.id }, select: { id: true, status: true } });
  if (!plan) throw ApiError.notFound(PLAN_NOT_FOUND);
  // المتابعة بعد 6 أشهر تأتي غالبًا بعد إكمال العلاج، لذلك مسموحة للنشطة والمكتملة؛ الملغاة لا.
  if (plan.status === "CANCELLED") throw ApiError.conflict("لا يمكن إضافة متابعة لخطة ملغاة.");
  const today = algeriaTodayUTCMidnight();
  const dueDate = input.dueDate ?? addCalendarMonths(today, input.afterMonths ?? 6);
  if (dueDate.getTime() < today.getTime()) throw ApiError.badRequest("تاريخ المتابعة لا يمكن أن يكون في الماضي.");
  await prisma.dentalFollowUp.create({ data: { treatmentPlanId: planId, dueDate } });
  return loadOwnedPlan(doctor.id, planId);
}

export async function updateFollowUp(userId: string, followUpId: string, input: UpdateFollowUpInput) {
  const doctor = await requireDentalDoctor(userId);
  const f = await prisma.dentalFollowUp.findFirst({
    where: { id: followUpId, treatmentPlan: { doctorId: doctor.id } },
    select: { id: true, status: true, treatmentPlanId: true },
  });
  if (!f) throw ApiError.notFound("المتابعة غير موجودة.");
  if (Object.keys(input).length === 0) throw ApiError.badRequest("لا توجد أي تغييرات لحفظها.");

  const allowed: Record<string, string[]> = {
    DUE: ["COMPLETED", "DISMISSED"],
    // يدويًا: الطبيب يعتبرها مكتملة. لتجاهل متابعة مبرمجة يجب إلغاء موعدها أولًا (فتعود DUE تلقائيًا).
    SCHEDULED: ["COMPLETED"],
    DISMISSED: ["DUE"],
    COMPLETED: [],
  };
  if (input.status && input.status !== f.status && !allowed[f.status].includes(input.status)) {
    throw ApiError.badRequest("انتقال غير مسموح لحالة المتابعة.");
  }
  if (input.dueDate) {
    if (f.status !== "DUE") throw ApiError.conflict("لا يمكن تغيير تاريخ متابعة مبرمجة أو مغلقة.");
    if (input.dueDate.getTime() < algeriaTodayUTCMidnight().getTime()) throw ApiError.badRequest("تاريخ المتابعة لا يمكن أن يكون في الماضي.");
  }
  const r = await prisma.dentalFollowUp.updateMany({
    where: { id: followUpId, status: f.status },
    data: {
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.status
        ? { status: input.status, completedAt: input.status === "COMPLETED" ? new Date() : null }
        : {}),
    },
  });
  if (r.count !== 1) throw ApiError.conflict("تغيّرت حالة المتابعة للتو. حدّث الصفحة وأعد المحاولة.");
  return loadOwnedPlan(doctor.id, f.treatmentPlanId);
}

// ------------------------- جهة المريض (قراءة فقط) -------------------------

const PATIENT_PLAN_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  estimatedSessions: true,
  estimatedTotalCost: true,
  startedAt: true,
  completedAt: true,
  familyMemberId: true,
  familyMember: { select: FAMILY_MEMBER_PUBLIC_SELECT },
  patient: { select: { firstName: true, lastName: true } },
  doctor: { select: { firstName: true, lastName: true, specialty: { select: { nameAr: true } } } },
  // بلا notes: ملاحظات الطبيب الداخلية لا تظهر للمريض.
  sessions: {
    select: {
      id: true,
      sessionNumber: true,
      title: true,
      plannedDate: true,
      completedAt: true,
      status: true,
      appointment: { select: { id: true, date: true, startTime: true, status: true } },
    },
    orderBy: [{ sessionNumber: "asc" as const }, { createdAt: "asc" as const }],
  },
  followUps: {
    where: { status: { in: ["DUE" as const, "SCHEDULED" as const, "COMPLETED" as const] } },
    select: {
      id: true,
      dueDate: true,
      status: true,
      completedAt: true,
      appointment: { select: { id: true, date: true, startTime: true, status: true } },
    },
    orderBy: { dueDate: "asc" as const },
  },
} satisfies Prisma.DentalTreatmentPlanSelect;

function patientPlanView(p: Prisma.DentalTreatmentPlanGetPayload<{ select: typeof PATIENT_PLAN_SELECT }>) {
  const { familyMember, patient, ...rest } = p;
  return { ...rest, beneficiary: beneficiaryOf({ familyMemberId: p.familyMemberId, familyMember, patient }) };
}

export async function listPatientPlans(userId: string, familyMemberFilter?: "self" | string) {
  const patientId = await requirePatientIdForUser(userId);
  const filter =
    familyMemberFilter === undefined ? {} : familyMemberFilter === "self" ? { familyMemberId: null } : { familyMemberId: familyMemberFilter };
  const plans = await prisma.dentalTreatmentPlan.findMany({
    where: { patientId, ...filter },
    select: PATIENT_PLAN_SELECT,
    orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    take: 100,
  });
  return plans.map(patientPlanView);
}

export async function getPatientPlan(userId: string, planId: string) {
  const patientId = await requirePatientIdForUser(userId);
  const plan = await prisma.dentalTreatmentPlan.findFirst({ where: { id: planId, patientId }, select: PATIENT_PLAN_SELECT });
  if (!plan) throw ApiError.notFound(PLAN_NOT_FOUND);
  return patientPlanView(plan);
}
