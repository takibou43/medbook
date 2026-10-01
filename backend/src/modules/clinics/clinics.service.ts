import crypto from "crypto";
import { Prisma, Role, InviteStatus, SubscriptionStatus, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../utils/password";
import { hashToken } from "../../lib/tokens";
import { ApiError } from "../../utils/ApiError";
import { clinicMonthlyTotal, CLINIC_DOCTOR_MONTHLY_DZD, activeClinicWhere } from "../../lib/clinicBilling";
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
      const linked = await tx.doctor.updateMany({ where: { id: user.doctor.id, clinicId: null }, data: { clinicId: clinic.id, wilayaId: clinic.wilayaId, cityId: clinic.cityId, address: clinic.address } });
      if (!linked.count) throw ApiError.conflict("الطبيب مرتبط بعيادة بالفعل.");
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
    doctorCount: doctors.length, monthlyPerDoctor: CLINIC_DOCTOR_MONTHLY_DZD,
    monthlyTotal: clinicMonthlyTotal(doctors.length), paidDoctorCount: clinic.paidDoctorCount,
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
    const { invite, clinic } = await consumeInvite(tx, token);
    const user = await tx.user.findUnique({ where: { id: userId }, include: { doctor: true } });
    if (!user?.isActive || user.role !== Role.DOCTOR || !user.doctor || user.email.toLowerCase() !== invite.email.toLowerCase()) throw ApiError.forbidden("الدعوة مخصصة لبريد طبيب آخر.");
    if (user.doctor.clinicId) throw ApiError.conflict("الطبيب مرتبط بعيادة بالفعل.");
    // Conditional update also prevents simultaneous invitations to different clinics.
    const joined = await tx.doctor.updateMany({ where: { id: user.doctor.id, clinicId: null }, data: { clinicId: clinic.id, wilayaId: clinic.wilayaId, cityId: clinic.cityId, address: clinic.address } });
    if (!joined.count) throw ApiError.conflict("الطبيب مرتبط بعيادة بالفعل.");
    return { clinicId: clinic.id };
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
  return clinics.map(c => ({ ...c, monthlyTotal: clinicMonthlyTotal(c._count.doctors) }));
}
export async function adminUpdateClinic(id: string, data: {
  verificationStatus?: VerificationStatus; subscriptionStatus?: SubscriptionStatus; subscriptionExpiresAt?: Date | null; paidDoctorCount?: number;
}) {
  if (!Object.keys(data).length) throw ApiError.badRequest("لا يوجد تغيير.");
  return prisma.$transaction(async tx => {
    await lockClinic(tx, id);
    const clinic = await tx.clinic.findUnique({ where: { id } });
    if (!clinic?.ownerId) throw ApiError.notFound("العيادة غير موجودة.");
    const count = await tx.doctor.count({ where: { clinicId: id } });
    const status = data.subscriptionStatus ?? clinic.subscriptionStatus;
    const expires = data.subscriptionExpiresAt === undefined ? clinic.subscriptionExpiresAt : data.subscriptionExpiresAt;
    const paidCount = data.paidDoctorCount ?? clinic.paidDoctorCount;
    if (status === SubscriptionStatus.ACTIVE && (!expires || expires <= new Date() || paidCount < count || paidCount < 1)) {
      throw ApiError.badRequest("تفعيل الاشتراك يتطلب تاريخ انتهاء مستقبليًا وعددًا مدفوعًا يشمل جميع أطباء العيادة.");
    }
    return tx.clinic.update({ where: { id }, data });
  });
}
