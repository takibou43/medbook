import { isDoctorAccount } from "../../lib/accountProfiles";
import { isDoctorProfilePublic } from "../../lib/doctorVisibility";
import { queueNewDoctorAreaNotifications, pushNewDoctorAreaNotification } from "../notifications/newDoctorArea.service";
import { activatePendingClinicRewards, clinicReferralBilling } from "../../lib/clinicReferralReward";
import { withPublicFee, clinicDoctorTermsSchema, clinicSharePercent, effectiveAppointmentPrice, summarizeFinance } from "../../lib/clinicFinance";
import { writeAudit } from "../../lib/audit";
import crypto from "crypto";
import { Prisma, Role, InviteStatus, SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../utils/password";
import { hashToken } from "../../lib/tokens";
import { ApiError } from "../../utils/ApiError";
import { CLINIC_DOCTOR_MONTHLY_DZD, activeClinicWhere } from "../../lib/clinicBilling";
import { PUBLIC_DOCTOR_SELECT } from "../doctors/doctors.service";
import { ClinicProfileInput, registerClinicSchema, acceptClinicInviteSchema } from "./clinics.schema";
import { ClinicPermission, CLINIC_PERMISSIONS } from "../../lib/clinicPermissions";
import * as assistantsService from "../assistants/assistants.service";

export const PUBLIC_CLINIC_SELECT = {
  id: true, nameAr: true, address: true, phone: true, description: true, photoUrl: true,
  wilaya: { select: { id: true, nameAr: true } }, city: { select: { id: true, nameAr: true } },
} satisfies Prisma.ClinicSelect;
const inviteSelect = { id: true, email: true, status: true, expiresAt: true, createdAt: true, termsPriceDzd: true, termsDoctorSharePercent: true } as const;
const clinicAssistantSelect = { id: true, doctorId: true, clinicId: true, allDoctors: true, allowedDoctorIds: true, firstName: true, lastName: true, isActive: true, user: { select: { email: true } } } as const;
export async function lockClinic(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"clinic-members:" + id}, 0))`;
}
type InviteTerms = { termsPriceDzd?: number | null; termsDoctorSharePercent?: number | null };
async function requestTransfer(tx: Prisma.TransactionClient, doctorId: string, clinicId: string, terms: InviteTerms = {}) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"clinic-transfer:" + doctorId}, 0))`;
  const doctor = await tx.doctor.findUniqueOrThrow({ where: { id: doctorId } });
  if (doctor.clinicId) throw ApiError.conflict("الطبيب مرتبط بعيادة بالفعل.");
  if (await tx.clinicTransferRequest.findUnique({ where: { pendingDoctorId: doctorId } })) throw ApiError.conflict("لديك طلب انتقال بانتظار مراجعة الإدارة.");
  return tx.clinicTransferRequest.create({ data: { doctorId, clinicId, pendingDoctorId: doctorId, termsPriceDzd: terms.termsPriceDzd ?? null, termsDoctorSharePercent: terms.termsDoctorSharePercent ?? null } });
}
export async function requestClinicTransfer(userId: string, clinicId: string) {
  return prisma.$transaction(async tx => {
    await lockClinic(tx, clinicId);
    const clinic = await tx.clinic.findFirst({ where: { id: clinicId, ...activeClinicWhere() }, select: { id: true } });
    const doctor = await tx.doctor.findUnique({ where: { userId }, include: { user: { select: { isActive: true } } } });
    if (!clinic) throw ApiError.notFound("العيادة غير متاحة لطلب الانتقال.");
    if (!doctor?.user.isActive) throw ApiError.forbidden();
    return requestTransfer(tx, doctor.id, clinic.id);
  });
}
export async function listOwnTransfers(userId: string) {
  return prisma.clinicTransferRequest.findMany({ where: { doctor: { userId } }, select: { id: true, status: true, createdAt: true, reviewedAt: true, clinic: { select: { nameAr: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
}
export async function adminListTransfers() {
  return prisma.clinicTransferRequest.findMany({ where: { status: InviteStatus.PENDING }, include: { clinic: { select: { nameAr: true } }, doctor: { select: { firstName: true, lastName: true, user: { select: { email: true } } } } }, orderBy: { createdAt: "asc" }, take: 100 });
}
export async function reviewTransfer(adminId: string, id: string, approve: boolean) {
  return prisma.$transaction(async tx => {
    const request = await tx.clinicTransferRequest.findUnique({ where: { id } });
    if (!request) throw ApiError.notFound();
    await lockClinic(tx, request.clinicId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"clinic-transfer:" + request.doctorId}, 0))`;
    const claimed = await tx.clinicTransferRequest.updateMany({ where: { id, status: InviteStatus.PENDING }, data: { status: approve ? InviteStatus.ACCEPTED : InviteStatus.REVOKED, pendingDoctorId: null, reviewedAt: new Date(), reviewedBy: adminId } });
    if (!claimed.count) throw ApiError.conflict("تمت مراجعة الطلب بالفعل.");
    if (approve) {
      const clinic = await tx.clinic.findFirst({ where: { id: request.clinicId, ...activeClinicWhere() } });
      if (!clinic) throw ApiError.badRequest("وثّق العيادة وفعّل اشتراكها قبل الموافقة على الانتقال.");
      const count = await tx.doctor.count({ where: { clinicId: clinic.id } });
      if (count >= clinic.paidDoctorCount) throw ApiError.conflict("زِد السعة المدفوعة قبل الموافقة على انتقال الطبيب.");
      const joined = await tx.doctor.updateMany({ where: { id: request.doctorId, clinicId: null, user: { isActive: true } }, data: { clinicId: clinic.id, clinicManagerForId: null, clinicPermissions: [], wilayaId: clinic.wilayaId, cityId: clinic.cityId, address: clinic.address } });
      if (!joined.count) throw ApiError.conflict("الطبيب غير متاح للانتقال أو مرتبط بعيادة بالفعل.");
      // الطلبات القديمة التي حملت شروط دعوة تُطبّق عند اعتماد طلب الانتقال.
      if (request.termsPriceDzd != null || request.termsDoctorSharePercent != null) {
        const data = { appointmentPriceDzd: request.termsPriceDzd, doctorSharePercent: request.termsDoctorSharePercent, clinicId: clinic.id, updatedByUserId: clinic.ownerId };
        await tx.clinicDoctorTerms.upsert({ where: { doctorId: request.doctorId }, create: { doctorId: request.doctorId, ...data }, update: data });
      } else {
        // انتقال بلا شروط: لا يبقى للطبيب شروط من عيادة سابقة.
        await tx.clinicDoctorTerms.deleteMany({ where: { doctorId: request.doctorId, clinicId: { not: clinic.id } } });
      }
    }
    return tx.clinicTransferRequest.findUniqueOrThrow({ where: { id } });
  });
}
async function validateLocation(input: ClinicProfileInput, db: Prisma.TransactionClient = prisma) {
  const city = await db.city.findFirst({ where: { id: input.cityId, wilayaId: input.wilayaId }, select: { id: true } });
  if (!city) throw ApiError.badRequest("المدينة لا تتبع الولاية المحددة.");
}
export async function ownedClinic(userId: string, db: Prisma.TransactionClient = prisma, permission?: ClinicPermission | "OWNER") {
  let clinic = await db.clinic.findUnique({ where: { ownerId: userId }, include: { owner: { select: { isActive: true } } } });
  if (!clinic) {
    const doctor = await db.doctor.findUnique({ where: { userId }, select: { clinicId: true, clinicManagerForId: true, clinicPermissions: true, user: { select: { isActive: true } } } });
    if (doctor?.clinicId && doctor.clinicManagerForId === doctor.clinicId && doctor.user.isActive) {
      if (permission === "OWNER" || (permission && !doctor.clinicPermissions.includes(permission))) throw ApiError.forbidden("هذه الصلاحية يمنحها مالك العيادة فقط.");
      clinic = await db.clinic.findUnique({ where: { id: doctor.clinicId }, include: { owner: { select: { isActive: true } } } });
    }
  }
  if (!clinic) throw ApiError.notFound("لا توجد عيادة مرتبطة بحسابك.");
  if (!clinic.owner?.isActive) throw ApiError.forbidden();
  return clinic;
}
export async function registerClinic(input: z.infer<typeof registerClinicSchema>) {
  await validateLocation(input.clinic);
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async tx => {
    const existing = await tx.user.findFirst({ where: { email: { equals: input.email, mode: "insensitive" } } });
    if (existing) throw ApiError.conflict("البريد الإلكتروني مستخدم مسبقًا. سجّل الدخول لإنشاء عيادتك.");
    const user = await tx.user.create({ data: { email: input.email, passwordHash, role: input.doctor ? Role.DOCTOR : Role.CLINIC_OWNER } });
    const clinic = await tx.clinic.create({ data: { ...input.clinic, ownerId: user.id } });
    if (input.doctor) await tx.doctor.create({ data: {
      ...input.doctor, userId: user.id, clinicId: clinic.id, wilayaId: clinic.wilayaId, cityId: clinic.cityId, address: clinic.address,
    } });
    return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: { doctor: true, ownedClinic: true } });
  });
}
// An existing independent doctor keeps the same account and becomes the owner.
export async function createOwnClinic(userId: string, input: ClinicProfileInput) {
  await validateLocation(input);
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { doctor: true, ownedClinic: true } });
    if (!user?.isActive || (!isDoctorAccount(user) && user.role !== Role.CLINIC_OWNER)) throw ApiError.forbidden();
    if (user.ownedClinic || user.doctor?.clinicId) throw ApiError.conflict("حسابك مرتبط بعيادة بالفعل.");
    const clinic = await tx.clinic.create({ data: { ...input, ownerId: userId } });
    if (user.doctor) {
      await requestTransfer(tx, user.doctor.id, clinic.id);
    }
    return clinic;
  });
}
export async function updateOwnClinic(userId: string, input: ClinicProfileInput) {
  await validateLocation(input);
  const clinic = await ownedClinic(userId, prisma, "EDIT_PROFILE");
  return prisma.$transaction(async tx => {
    await lockClinic(tx, clinic.id);
    // Changes to the public identity/location require re-verification.
    const changedIdentity = input.nameAr !== clinic.nameAr || input.address !== clinic.address || input.cityId !== clinic.cityId || input.wilayaId !== clinic.wilayaId;
    const updated = await tx.clinic.update({ where: { id: clinic.id }, data: { ...input, ...(changedIdentity ? { verificationStatus: VerificationStatus.PENDING } : {}) } });
    await tx.doctor.updateMany({ where: { clinicId: clinic.id }, data: { wilayaId: updated.wilayaId, cityId: updated.cityId, address: updated.address } });
    return updated;
  });
}
export async function getOwnClinic(userId: string) {
  const clinic = await ownedClinic(userId);
  const isOwner = clinic.ownerId === userId;
  const manager = isOwner ? null : await prisma.doctor.findUnique({ where: { userId }, select: { clinicPermissions: true } });
  const permissions = isOwner ? [...CLINIC_PERMISSIONS] : manager?.clinicPermissions ?? [];
  const [doctors, invites, sharedAssistants] = await Promise.all([
    prisma.doctor.findMany({ where: { clinicId: clinic.id }, select: {
      id: true, userId: true, firstName: true, lastName: true, verificationStatus: true, clinicId: true, consultationFee: true, clinicManagerForId: true, clinicPermissions: true,
      clinicTerms: { select: { clinicId: true, appointmentPriceDzd: true, doctorSharePercent: true } },
      specialty: { select: { nameAr: true } }, user: { select: { email: true, isActive: true } },
      assistants: { where: { OR: [{ clinicId: clinic.id }, { clinicId: null }] }, select: clinicAssistantSelect },
    }, orderBy: { firstName: "asc" } }),
    prisma.clinicDoctorInvite.findMany({ where: { clinicId: clinic.id, status: InviteStatus.PENDING }, select: inviteSelect }),
    prisma.assistant.findMany({ where: { clinicId: clinic.id }, select: clinicAssistantSelect }),
  ]);
  const { owner: _owner, ...safeClinic } = clinic;
  return { ...safeClinic, isOwner, permissions, assistants: [...new Map([...doctors.flatMap(d => d.assistants), ...sharedAssistants].map(a => [a.id, a])).values()], doctors: doctors.map(d => {
    const visible = [...new Map([...d.assistants, ...sharedAssistants].map(a => [a.id, a])).values()].filter(a => !a.clinicId || a.allDoctors || a.allowedDoctorIds.includes(d.id));
    const view = managerDoctorView({ ...d, assistants: visible });
    return { ...view, terms: permissions.includes("MANAGE_TERMS") || permissions.includes("VIEW_FINANCE") ? view.terms : null };
  }), invites: isOwner ? invites : [], billing: {
    ...clinicReferralBilling(doctors.length, clinic.referralDiscountUntil), monthlyPerDoctor: CLINIC_DOCTOR_MONTHLY_DZD,
    paidDoctorCount: clinic.paidDoctorCount,
  } };
}
export async function inviteDoctor(userId: string, email: string, terms: { appointmentPriceDzd?: number; doctorSharePercent?: number } = {}) {
  const clinic = await ownedClinic(userId, prisma, "OWNER");
  const rawToken = crypto.randomBytes(32).toString("hex");
  return prisma.$transaction(async tx => {
    await lockClinic(tx, clinic.id);
    const user = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, include: { doctor: true } });
    if (user && (!isDoctorAccount(user) || !user.isActive || user.doctor?.clinicId)) throw ApiError.conflict("البريد مرتبط بحساب غير متاح للانضمام إلى العيادة.");
    await tx.clinicDoctorInvite.updateMany({ where: { clinicId: clinic.id, email, status: InviteStatus.PENDING }, data: { status: InviteStatus.REVOKED } });
    const invite = await tx.clinicDoctorInvite.create({ data: { clinicId: clinic.id, email, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 7 * 86400000), termsPriceDzd: terms.appointmentPriceDzd ?? null, termsDoctorSharePercent: terms.doctorSharePercent ?? null }, select: inviteSelect });
    return { invite, rawToken };
  });
}
export async function revokeDoctorInvite(userId: string, id: string) {
  const clinic = await ownedClinic(userId, prisma, "OWNER");
  const result = await prisma.clinicDoctorInvite.updateMany({ where: { id, clinicId: clinic.id, status: InviteStatus.PENDING }, data: { status: InviteStatus.REVOKED } });
  if (!result.count) throw ApiError.notFound("الدعوة غير موجودة أو مستعملة.");
}
function assertInvite(invite: { status: InviteStatus; expiresAt: Date } | null) {
  if (!invite || invite.status !== InviteStatus.PENDING || invite.expiresAt <= new Date()) throw ApiError.badRequest("الدعوة غير صالحة أو انتهت صلاحيتها.");
}
export async function previewInvite(token: string) {
  const invite = await prisma.clinicDoctorInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { clinic: { select: { nameAr: true, owner: { select: { isActive: true } } } } } });
  assertInvite(invite);
  if (!invite!.clinic.owner?.isActive) throw ApiError.forbidden();
  const account = await prisma.user.findFirst({ where: { email: { equals: invite!.email, mode: "insensitive" } }, select: { id: true } });
  return { email: invite!.email, clinicName: invite!.clinic.nameAr, existingAccount: !!account,
    appointmentPriceDzd: invite!.termsPriceDzd, doctorSharePercent: invite!.termsDoctorSharePercent };
}
async function consumeInvite(tx: Prisma.TransactionClient, token: string) {
  const invite = await tx.clinicDoctorInvite.findUnique({ where: { tokenHash: hashToken(token) } });
  assertInvite(invite);
  await lockClinic(tx, invite!.clinicId);
  const claimed = await tx.clinicDoctorInvite.updateMany({ where: { id: invite!.id, status: InviteStatus.PENDING, expiresAt: { gt: new Date() } }, data: { status: InviteStatus.ACCEPTED, acceptedAt: new Date() } });
  if (!claimed.count) throw ApiError.conflict("تم استعمال الدعوة أو إلغاؤها.");
  const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: invite!.clinicId }, include: { owner: { select: { isActive: true } } } });
  if (!clinic.owner?.isActive) throw ApiError.forbidden();
  const count = await tx.doctor.count({ where: { clinicId: clinic.id } });
  if (clinic.subscriptionStatus === SubscriptionStatus.ACTIVE && clinic.subscriptionExpiresAt && clinic.subscriptionExpiresAt > new Date() && count >= clinic.paidDoctorCount) {
    throw ApiError.conflict("يلزم زيادة عدد الأطباء المشمولين بالاشتراك عبر الإدارة قبل إضافة طبيب جديد.");
  }
  return { invite: invite!, clinic };
}
export async function acceptNewDoctor(input: z.infer<typeof acceptClinicInviteSchema>) {
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async tx => {
    const { invite, clinic } = await consumeInvite(tx, input.token);
    if (await tx.user.findFirst({ where: { email: { equals: invite.email, mode: "insensitive" } } })) throw ApiError.conflict("الحساب موجود. سجّل الدخول لقبول الدعوة.");
    return tx.user.create({ data: { email: invite.email, passwordHash, role: Role.DOCTOR,
      doctor: { create: { ...input.doctor, clinicId: clinic.id, wilayaId: clinic.wilayaId, cityId: clinic.cityId, address: clinic.address,
        ...(invite.termsPriceDzd != null || invite.termsDoctorSharePercent != null
          ? { clinicTerms: { create: { clinicId: clinic.id, appointmentPriceDzd: invite.termsPriceDzd, doctorSharePercent: invite.termsDoctorSharePercent, updatedByUserId: clinic.ownerId } } } : {}) } },
    }, include: { doctor: true } });
  });
}
export async function acceptExistingDoctor(userId: string, token: string) {
  return prisma.$transaction(async tx => {
    const invite = await tx.clinicDoctorInvite.findUnique({ where: { tokenHash: hashToken(token) } });
    assertInvite(invite);
    await lockClinic(tx, invite!.clinicId);
    const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: invite!.clinicId }, include: { owner: { select: { isActive: true } } } });
    if (!clinic.owner?.isActive) throw ApiError.forbidden();
    const user = await tx.user.findUnique({ where: { id: userId }, include: { doctor: true } });
    if (!user?.isActive || !isDoctorAccount(user) || !user.doctor || user.email.toLowerCase() !== invite!.email.toLowerCase()) throw ApiError.forbidden("الدعوة مخصصة لبريد طبيب آخر.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"clinic-transfer:" + user.doctor.id}, 0))`;
    if (user.doctor.clinicId) throw ApiError.conflict("الطبيب مرتبط بعيادة بالفعل.");
    // A clinic invitation already carries the owner's consent; only the invited doctor must accept.
    // Reuse the single-use invite and paid-capacity checks used for new doctors.
    await consumeInvite(tx, token);
    const joined = await tx.doctor.updateMany({ where: { id: user.doctor.id, clinicId: null, user: { isActive: true } },
      data: { clinicId: clinic.id, clinicManagerForId: null, clinicPermissions: [], wilayaId: clinic.wilayaId, cityId: clinic.cityId, address: clinic.address } });
    if (!joined.count) throw ApiError.conflict("الطبيب مرتبط بعيادة بالفعل أو حسابه غير متاح.");
    if (invite!.termsPriceDzd != null || invite!.termsDoctorSharePercent != null) {
      const data = { clinicId: clinic.id, appointmentPriceDzd: invite!.termsPriceDzd, doctorSharePercent: invite!.termsDoctorSharePercent, updatedByUserId: clinic.ownerId };
      await tx.clinicDoctorTerms.upsert({ where: { doctorId: user.doctor.id }, create: { doctorId: user.doctor.id, ...data }, update: data });
    } else {
      await tx.clinicDoctorTerms.deleteMany({ where: { doctorId: user.doctor.id } });
    }
    // An older pending request must not be approved later and move the doctor again.
    await tx.clinicTransferRequest.updateMany({ where: { doctorId: user.doctor.id, status: InviteStatus.PENDING },
      data: { status: InviteStatus.REVOKED, pendingDoctorId: null, reviewedAt: new Date(), reviewedBy: userId } });
    await writeAudit({ userId, action: "CLINIC_INVITE_ACCEPTED", entity: "Doctor", entityId: user.doctor.id,
      meta: { clinicId: clinic.id, inviteId: invite!.id } }, tx);
    return { clinicId: clinic.id, clinicName: clinic.nameAr };
  });
}
export async function clinicDoctor(userId: string, doctorId: string) {
  const clinic = await ownedClinic(userId);
  const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, clinicId: clinic.id }, select: { id: true, userId: true } });
  if (!doctor) throw ApiError.notFound("الطبيب غير موجود في عيادتك.");
  return doctor;
}
export async function findOwnClinicAssistant(userId: string, email: string) {
  const clinic = await ownedClinic(userId);
  return prisma.assistant.findFirst({
    where: { clinicId: clinic.id, user: { role: Role.ASSISTANT, email: { equals: email, mode: "insensitive" } } },
    select: clinicAssistantSelect,
  });
}

export async function setOwnClinicAssistantActive(userId: string, doctorId: string, assistantId: string, isActive: boolean) {
  const doctor = await clinicDoctor(userId, doctorId);
  const clinic = await ownedClinic(userId, prisma, "MANAGE_ASSISTANT_STATUS");
  const changed = await prisma.assistant.updateMany({
    where: { id: assistantId, OR: [{ clinicId: clinic.id }, { clinicId: null, doctorId: doctor.id }] },
    data: { isActive },
  });
  if (!changed.count) throw ApiError.notFound("المساعد غير موجود في عيادتك.");
  return prisma.assistant.findUnique({ where: { id: assistantId }, select: clinicAssistantSelect });
}

type AssistantScopeInput = { allDoctors: boolean; doctorIds: string[] };
async function validateAssistantScope(clinicId: string, input: AssistantScopeInput, db: Prisma.TransactionClient = prisma) {
  const ids = input.allDoctors ? [] : [...new Set(input.doctorIds)];
  if (!input.allDoctors && !ids.length) throw ApiError.badRequest("اختر طبيبًا واحدًا على الأقل.");
  const count = await db.doctor.count({ where: { clinicId, id: { in: ids }, user: { isActive: true } } });
  if (count !== ids.length) throw ApiError.badRequest("اختر أطباء نشطين من هذه العيادة فقط.");
  return { allDoctors: input.allDoctors, allowedDoctorIds: ids };
}

export async function inviteOwnClinicAssistant(userId: string, email: string, input?: AssistantScopeInput) {
  const clinic = await ownedClinic(userId, prisma, "OWNER");
  const existing = await findOwnClinicAssistant(userId, email);
  // An old client reusing an email must never widen a restricted assistant's access.
  if (existing) {
    const assistant = input ? await setOwnClinicAssistantScope(userId, existing.id, input) : existing;
    return { assistant, alreadyShared: true };
  }
  const scope = await validateAssistantScope(clinic.id, input ?? { allDoctors: true, doctorIds: [] });
  const doctor = await prisma.doctor.findFirst({ where: { clinicId: clinic.id, user: { isActive: true }, ...(scope.allDoctors ? {} : { id: { in: scope.allowedDoctorIds } }) }, orderBy: { id: "asc" }, select: { userId: true } });
  if (!doctor) throw ApiError.badRequest("أضف طبيبًا نشطًا إلى العيادة أولًا.");
  const result = await assistantsService.createInvite(doctor.userId, email, { clinicId: clinic.id, ...scope });
  const { tokenHash: _hash, ...invite } = result.invite;
  return { invite, rawToken: result.rawToken };
}

export async function setOwnClinicAssistantScope(userId: string, assistantId: string, input: AssistantScopeInput) {
  return prisma.$transaction(async tx => {
    const clinic = await ownedClinic(userId, tx, "OWNER");
    await lockClinic(tx, clinic.id);
    const scope = await validateAssistantScope(clinic.id, input, tx);
    const changed = await tx.assistant.updateMany({ where: { id: assistantId, clinicId: clinic.id }, data: scope });
    if (!changed.count) throw ApiError.notFound("المساعد غير موجود في عيادتك.");
    return tx.assistant.findUniqueOrThrow({ where: { id: assistantId }, select: clinicAssistantSelect });
  });
}

export async function setClinicManager(userId: string, doctorId: string, input: { isManager: boolean; permissions: string[] }) {
  return prisma.$transaction(async tx => {
    const clinic = await ownedClinic(userId, tx, "OWNER");
    await lockClinic(tx, clinic.id);
    const doctor = await tx.doctor.findFirst({ where: { id: doctorId, clinicId: clinic.id, user: { isActive: true } }, select: { id: true, userId: true } });
    if (!doctor) throw ApiError.notFound("الطبيب غير موجود في عيادتك.");
    if (doctor.userId === clinic.ownerId) throw ApiError.badRequest("صلاحيات المالك ثابتة ولا تحتاج تعيين مدير.");
    return tx.doctor.update({ where: { id: doctor.id }, data: { clinicManagerForId: input.isManager ? clinic.id : null, clinicPermissions: input.isManager ? [...new Set(input.permissions)] : [] }, select: { id: true, clinicManagerForId: true, clinicPermissions: true } });
  });
}
export async function searchClinics(query: { q?: string; wilayaId?: string; cityId?: string; page: number }) {
  const where: Prisma.ClinicWhereInput = { ...activeClinicWhere(), ...(query.q ? { nameAr: { contains: query.q, mode: "insensitive" } } : {}),
    ...(query.wilayaId ? { wilayaId: query.wilayaId } : {}), ...(query.cityId ? { cityId: query.cityId } : {}),
    doctors: { some: { verificationStatus: VerificationStatus.VERIFIED, user: { isActive: true } } },
  };
  const [items, total] = await Promise.all([prisma.clinic.findMany({ where, select: { ...PUBLIC_CLINIC_SELECT, _count: { select: { doctors: { where: { verificationStatus: VerificationStatus.VERIFIED, user: { isActive: true } } } } } }, take: 12, skip: (query.page - 1) * 12, orderBy: { nameAr: "asc" } }), prisma.clinic.count({ where })]);
  return { items, total, page: query.page, totalPages: Math.max(1, Math.ceil(total / 12)) };
}
export async function publicClinic(id: string) {
  const clinic = await prisma.clinic.findFirst({ where: { id, ...activeClinicWhere() }, select: {
    ...PUBLIC_CLINIC_SELECT, doctors: { where: { verificationStatus: VerificationStatus.VERIFIED, user: { isActive: true } }, select: PUBLIC_DOCTOR_SELECT, orderBy: { firstName: "asc" } },
  } });
  if (!clinic) throw ApiError.notFound("العيادة غير موجودة أو غير متاحة للحجز.");
  return { ...clinic, doctors: clinic.doctors.map(withPublicFee) };
}
export async function adminListClinics() {
  const clinics = await prisma.clinic.findMany({ where: { ownerId: { not: null } }, include: { owner: { select: { email: true } }, _count: { select: { doctors: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return clinics.map(c => ({ ...c, ...clinicReferralBilling(c._count.doctors, c.referralDiscountUntil) }));
}
export async function adminUpdateClinic(id: string, data: {
  verificationStatus?: VerificationStatus; subscriptionStatus?: SubscriptionStatus; subscriptionExpiresAt?: Date | null; paidDoctorCount?: number;
}) {
  if (!Object.keys(data).length) throw ApiError.badRequest("لا يوجد تغيير.");
  const result = await prisma.$transaction(async tx => {
    await lockClinic(tx, id);
    const clinic = await tx.clinic.findUnique({ where: { id }, include: { owner: { select: { isActive: true } } } });
    if (!clinic?.ownerId) throw ApiError.notFound("العيادة غير موجودة.");
    const count = await tx.doctor.count({ where: { clinicId: id } });
    const status = data.subscriptionStatus ?? clinic.subscriptionStatus;
    const expires = data.subscriptionExpiresAt === undefined ? clinic.subscriptionExpiresAt : data.subscriptionExpiresAt;
    const paidCount = data.paidDoctorCount ?? clinic.paidDoctorCount;
    if (status === SubscriptionStatus.ACTIVE && (!expires || expires <= new Date() || paidCount < count || paidCount < 1)) {
      throw ApiError.badRequest("تفعيل الاشتراك يتطلب تاريخ انتهاء مستقبليًا وعددًا مدفوعًا يشمل جميع أطباء العيادة.");
    }
    const updated = await tx.clinic.update({ where: { id }, data });
    const rewardData = activatePendingClinicRewards(updated);
    const finalClinic = Object.keys(rewardData).length ? await tx.clinic.update({ where: { id }, data: rewardData }) : updated;
    const now = new Date();
    const doctors = await tx.doctor.findMany({ where: { clinicId: id }, include: {
      user: { select: { isActive: true } }, city: { select: { nameAr: true } }, specialty: { select: { nameAr: true } },
    } });
    const announcements: { doctor: typeof doctors[number] & { clinic: typeof finalClinic }; recipients: string[] }[] = [];
    for (const doctor of doctors) {
      const after = { ...doctor, clinic: { ...finalClinic, owner: clinic.owner } };
      if (!isDoctorProfilePublic({ ...doctor, clinic }, now) && isDoctorProfilePublic(after, now)) {
        const recipients = await queueNewDoctorAreaNotifications(tx, after);
        announcements.push({ doctor: after, recipients });
      }
    }
    return { clinic: finalClinic, announcements };
  });
  for (const announcement of result.announcements) {
    pushNewDoctorAreaNotification(announcement.recipients, announcement.doctor);
  }
  return result.clinic;
}


/* ---------------- أسعار الأطباء ونسبهم (مدير العيادة وحده) ---------------- */

type TermsRow = { clinicId: string; appointmentPriceDzd: number | null; doctorSharePercent: number | null } | null;

/** عرض المدير: السعر الفعلي ومصدره، ونسبة الطبيب، ونسبة العيادة محسوبة (NULL إن لم تُحدَّد نسبة الطبيب). */
/** يظهر حرفيًا في التقرير: المبالغ تقديرية وليست إثبات تحصيل. */
export const FINANCE_ESTIMATE_NOTE =
  "المبالغ تقديرية: تُحسب للمواعيد المكتملة فقط بالسعر والنسبة المحفوظين وقت الحجز، وليست إثباتًا بأن المبلغ دُفع أو حُصِّل. المواعيد المكتملة التي لم تُحدَّد لها نسبة لا تدخل في المستحقات وتظهر في عدّاد «بلا نسبة». هذه النسبة منفصلة عن اشتراك مادبوك ولا يتم أي دفع أو تحويل عبر النظام.";

export function termsView(doctor: { clinicId: string | null; consultationFee: number | null; clinicTerms: TermsRow }) {
  const t = doctor.clinicTerms && doctor.clinicId === doctor.clinicTerms.clinicId ? doctor.clinicTerms : null;
  const share = t?.doctorSharePercent ?? null;
  return {
    appointmentPriceDzd: effectiveAppointmentPrice({ clinicId: doctor.clinicId, consultationFee: doctor.consultationFee, clinicTerms: doctor.clinicTerms }),
    priceSource: t?.appointmentPriceDzd != null ? ("CLINIC" as const) : ("DOCTOR_DEFAULT" as const),
    doctorSharePercent: share,
    clinicSharePercent: share == null ? null : clinicSharePercent(share),
  };
}
function managerDoctorView<T extends { clinicId: string | null; consultationFee: number | null; clinicTerms: TermsRow }>(doctor: T) {
  const { clinicTerms: _t, consultationFee: _f, clinicId: _c, ...rest } = doctor;
  return { ...rest, terms: termsView(doctor) };
}

// المدير يحدد/يعدّل سعر موعد طبيب تابع لعيادته ونسبته. التحقق في الخادم: ملكية العيادة، تبعية الطبيب لها،
// السعر عدد صحيح ≥ 0، النسبة 0..100، ونسبة العيادة لا تُقبل (تُحسب). يسري على المواعيد الجديدة فقط.
export async function setDoctorTerms(userId: string, doctorId: string, body: unknown) {
  const parsed = clinicDoctorTermsSchema.safeParse(body);
  if (!parsed.success) throw ApiError.badRequest("قيم السعر أو النسبة غير صالحة. السعر عدد صحيح موجب والنسبة بين 0 و100.");
  const input = parsed.data;
  const clinic = await ownedClinic(userId, prisma, "MANAGE_TERMS");
  return prisma.$transaction(async tx => {
    await lockClinic(tx, clinic.id);
    const doctor = await tx.doctor.findFirst({ where: { id: doctorId, clinicId: clinic.id }, select: { id: true, clinicId: true, consultationFee: true, clinicTerms: true } });
    if (!doctor) throw ApiError.notFound("الطبيب غير موجود في عيادتك.");
    // صف شروط يخص عيادة سابقة لا يُرثه المدير الجديد: يُعامل كأنه غير موجود، فلا تنتقل نسبة عيادة أخرى بصمت.
    const before = doctor.clinicTerms && doctor.clinicTerms.clinicId === clinic.id ? doctor.clinicTerms : null;
    const data = {
      appointmentPriceDzd: input.appointmentPriceDzd !== undefined ? input.appointmentPriceDzd : before?.appointmentPriceDzd ?? null,
      doctorSharePercent: input.doctorSharePercent !== undefined ? input.doctorSharePercent : before?.doctorSharePercent ?? null,
      clinicId: clinic.id, updatedByUserId: userId,
    };
    const saved = await tx.clinicDoctorTerms.upsert({ where: { doctorId: doctor.id }, create: { doctorId: doctor.id, ...data }, update: data });
    await writeAudit({ userId, action: "CLINIC_DOCTOR_TERMS_UPDATED", entity: "ClinicDoctorTerms", entityId: saved.id, meta: {
      clinicId: clinic.id, doctorId: doctor.id,
      priceBefore: before?.appointmentPriceDzd ?? null, priceAfter: saved.appointmentPriceDzd,
      shareBefore: before?.doctorSharePercent ?? null, shareAfter: saved.doctorSharePercent,
    } }, tx);
    return termsView({ clinicId: clinic.id, consultationFee: doctor.consultationFee, clinicTerms: saved });
  });
}

// تقرير العيادة المالي: لكل طبيب مستحقاته وحصة العيادة من المواعيد المكتملة وفق اللقطة المحفوظة وقت الحجز.
// لا دفع ولا تحويل: عرض حسابي فقط. المواعيد الملغاة ولم يحضر والمعلقة تظهر عددًا ولا تدخل أي مبلغ.
export async function clinicFinanceReport(userId: string, range: { from?: string; to?: string }) {
  const clinic = await ownedClinic(userId, prisma, "VIEW_FINANCE");
  const now = new Date();
  const from = new Date((range.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)) + "T00:00:00Z");
  const to = new Date((range.to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)) + "T00:00:00Z");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) throw ApiError.badRequest("نطاق التاريخ غير صالح.");
  if (to.getTime() - from.getTime() > 400 * 86400000) throw ApiError.badRequest("النطاق الأقصى 400 يوم.");
  const [doctors, rows] = await Promise.all([
    prisma.doctor.findMany({ where: { clinicId: clinic.id }, select: { id: true, firstName: true, lastName: true, clinicId: true, consultationFee: true, clinicTerms: true }, orderBy: { firstName: "asc" } }),
    // الانتماء للعيادة بحسب اللقطة وقت الحجز؛ ومواعيد ما قبل الميزة لأطباء العيادة الحاليين تُحسب بلا نسبة.
    prisma.appointment.findMany({
      where: { date: { gte: from, lte: to }, OR: [{ financial: { is: { clinicId: clinic.id } } }, { financial: { is: null }, doctor: { clinicId: clinic.id } }] },
      select: { doctorId: true, status: true, financial: { select: { priceDzd: true, doctorSharePercent: true } } },
      take: 200000,
    }),
  ]);
  const byDoctor = new Map<string, { status: import("@prisma/client").AppointmentStatus; priceDzd: number | null; doctorSharePercent: number | null }[]>();
  for (const r of rows) {
    const list = byDoctor.get(r.doctorId) ?? [];
    list.push({ status: r.status, priceDzd: r.financial?.priceDzd ?? null, doctorSharePercent: r.financial?.doctorSharePercent ?? null });
    byDoctor.set(r.doctorId, list);
  }
  const perDoctor = doctors.map(d => ({
    doctorId: d.id, name: `د. ${d.firstName} ${d.lastName}`, terms: termsView(d), summary: summarizeFinance(byDoctor.get(d.id) ?? []),
  }));
  const all = summarizeFinance([...byDoctor.values()].flat());
  return {
    from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), perDoctor, totals: all,
    notes: FINANCE_ESTIMATE_NOTE,
  };
}
