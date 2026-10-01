import { isDoctorProfilePublic } from "../../lib/doctorVisibility";
import { queueNewDoctorAreaNotifications, pushNewDoctorAreaNotification } from "../notifications/newDoctorArea.service";
import { activatePendingClinicRewards, clinicReferralBilling } from "../../lib/clinicReferralReward";
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

export const PUBLIC_CLINIC_SELECT = {
  id: true, nameAr: true, address: true, phone: true, description: true, photoUrl: true,
  wilaya: { select: { id: true, nameAr: true } }, city: { select: { id: true, nameAr: true } },
} satisfies Prisma.ClinicSelect;
const inviteSelect = { id: true, email: true, status: true, expiresAt: true, createdAt: true } as const;
export async function lockClinic(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"clinic-members:" + id}, 0))`;
}
async function requestTransfer(tx: Prisma.TransactionClient, doctorId: string, clinicId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"clinic-transfer:" + doctorId}, 0))`;
  const doctor = await tx.doctor.findUniqueOrThrow({ where: { id: doctorId } });
  if (doctor.clinicId) throw ApiError.conflict("الطبيب مرتبط بعيادة بالفعل.");
  if (await tx.clinicTransferRequest.findUnique({ where: { pendingDoctorId: doctorId } })) throw ApiError.conflict("لديك طلب انتقال بانتظار مراجعة الإدارة.");
  return tx.clinicTransferRequest.create({ data: { doctorId, clinicId, pendingDoctorId: doctorId } });
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
      const joined = await tx.doctor.updateMany({ where: { id: request.doctorId, clinicId: null, user: { isActive: true } }, data: { clinicId: clinic.id, wilayaId: clinic.wilayaId, cityId: clinic.cityId, address: clinic.address } });
      if (!joined.count) throw ApiError.conflict("الطبيب غير متاح للانتقال أو مرتبط بعيادة بالفعل.");
    }
    return tx.clinicTransferRequest.findUniqueOrThrow({ where: { id } });
  });
}
async function validateLocation(input: ClinicProfileInput, db: Prisma.TransactionClient = prisma) {
  const city = await db.city.findFirst({ where: { id: input.cityId, wilayaId: input.wilayaId }, select: { id: true } });
  if (!city) throw ApiError.badRequest("المدينة لا تتبع الولاية المحددة.");
}
export async function ownedClinic(userId: string, db: Prisma.TransactionClient = prisma) {
  const clinic = await db.clinic.findUnique({ where: { ownerId: userId }, include: { owner: { select: { isActive: true } } } });
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
    if (!user?.isActive || (user.role !== Role.DOCTOR && user.role !== Role.CLINIC_OWNER)) throw ApiError.forbidden();
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
  const clinic = await ownedClinic(userId);
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
  const [doctors, invites] = await Promise.all([
    prisma.doctor.findMany({ where: { clinicId: clinic.id }, select: {
      id: true, userId: true, firstName: true, lastName: true, verificationStatus: true,
      specialty: { select: { nameAr: true } }, user: { select: { email: true, isActive: true } },
      assistants: { select: { id: true, firstName: true, lastName: true, isActive: true, user: { select: { email: true } } } },
    }, orderBy: { firstName: "asc" } }),
    prisma.clinicDoctorInvite.findMany({ where: { clinicId: clinic.id, status: InviteStatus.PENDING }, select: inviteSelect }),
  ]);
  const { owner: _owner, ...safeClinic } = clinic;
  return { ...safeClinic, doctors, invites, billing: {
    ...clinicReferralBilling(doctors.length, clinic.referralDiscountUntil), monthlyPerDoctor: CLINIC_DOCTOR_MONTHLY_DZD,
    paidDoctorCount: clinic.paidDoctorCount,
  } };
}
export async function inviteDoctor(userId: string, email: string) {
  const clinic = await ownedClinic(userId);
  const rawToken = crypto.randomBytes(32).toString("hex");
  return prisma.$transaction(async tx => {
    await lockClinic(tx, clinic.id);
    const user = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, include: { doctor: true } });
    if (user && (user.role !== Role.DOCTOR || !user.isActive || user.doctor?.clinicId)) throw ApiError.conflict("البريد مرتبط بحساب غير متاح للانضمام إلى العيادة.");
    await tx.clinicDoctorInvite.updateMany({ where: { clinicId: clinic.id, email, status: InviteStatus.PENDING }, data: { status: InviteStatus.REVOKED } });
    const invite = await tx.clinicDoctorInvite.create({ data: { clinicId: clinic.id, email, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 7 * 86400000) }, select: inviteSelect });
    return { invite, rawToken };
  });
}
export async function revokeDoctorInvite(userId: string, id: string) {
  const clinic = await ownedClinic(userId);
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
  return { email: invite!.email, clinicName: invite!.clinic.nameAr };
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
      doctor: { create: { ...input.doctor, clinicId: clinic.id, wilayaId: clinic.wilayaId, cityId: clinic.cityId, address: clinic.address } },
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
    if (!user?.isActive || user.role !== Role.DOCTOR || !user.doctor || user.email.toLowerCase() !== invite!.email.toLowerCase()) throw ApiError.forbidden("الدعوة مخصصة لبريد طبيب آخر.");
    if (user.doctor.clinicId) throw ApiError.conflict("الطبيب مرتبط بعيادة بالفعل.");
    const claimed = await tx.clinicDoctorInvite.updateMany({ where: { id: invite!.id, status: InviteStatus.PENDING, expiresAt: { gt: new Date() } }, data: { status: InviteStatus.ACCEPTED, acceptedAt: new Date() } });
    if (!claimed.count) throw ApiError.conflict("تم استعمال الدعوة أو إلغاؤها.");
    return requestTransfer(tx, user.doctor.id, clinic.id);
  });
}
export async function clinicDoctor(userId: string, doctorId: string) {
  const clinic = await ownedClinic(userId);
  const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, clinicId: clinic.id }, select: { id: true, userId: true } });
  if (!doctor) throw ApiError.notFound("الطبيب غير موجود في عيادتك.");
  return doctor;
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
  return clinic;
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

