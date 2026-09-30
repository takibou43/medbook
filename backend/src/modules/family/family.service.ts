import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { CreateFamilyMemberInput, UpdateFamilyMemberInput, MAX_ACTIVE_FAMILY_MEMBERS } from "./family.schema";

/**
 * الحساب العائلي: صاحب الحساب (Patient من الجلسة) يدير أفراد عائلته ويحجز لهم.
 *
 * قواعد الأمان (كلها في الخادم):
 *  - ownerPatientId يُشتق دائمًا من الجلسة (userId → Patient)، ولا يُقبل من الطلب ولا يتغيّر بعد الإنشاء.
 *  - كل قراءة/تعديل/أرشفة تمر بـ findOwnedMember: المعرّف + ownerPatientId معًا. فرد من حساب آخر → 404
 *    (نفس رد «غير موجود» حتى لا يصبح المسار أداة لاكتشاف معرّفات الآخرين).
 *  - «الحذف» أرشفة فقط (archivedAt): المواعيد وخطط العلاج المرتبطة تبقى كما هي، والفرد يختفي من الاختيارات الجديدة.
 */

const MEMBER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  relationship: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FamilyMemberSelect;

export async function requirePatientIdForUser(userId: string): Promise<string> {
  const patient = await prisma.patient.findUnique({ where: { userId }, select: { id: true } });
  if (!patient) throw ApiError.forbidden("لا يوجد ملف مريض مرتبط بهذا الحساب.");
  return patient.id;
}

export const FAMILY_MEMBER_NOT_FOUND = "فرد العائلة غير موجود.";

async function findOwnedMember(ownerPatientId: string, id: string, db: Prisma.TransactionClient = prisma) {
  const member = await db.familyMember.findFirst({ where: { id, ownerPatientId }, select: MEMBER_SELECT });
  if (!member) throw ApiError.notFound(FAMILY_MEMBER_NOT_FOUND);
  return member;
}

/**
 * يُستعمل من مسارات الحجز: يتحقق أن familyMemberId القادم من العميل يخص صاحب الجلسة وأنه غير مؤرشف.
 * يعيد الاسم الموثوق من قاعدة البيانات (لا الاسم المرسل من الواجهة).
 */
export async function resolveBookableFamilyMember(ownerPatientId: string, familyMemberId: string) {
  const member = await prisma.familyMember.findFirst({
    where: { id: familyMemberId, ownerPatientId, archivedAt: null },
    select: { id: true, firstName: true, lastName: true, relationship: true },
  });
  if (!member) throw ApiError.notFound(FAMILY_MEMBER_NOT_FOUND);
  return member;
}

export async function listFamilyMembers(userId: string, includeArchived = false) {
  const ownerPatientId = await requirePatientIdForUser(userId);
  return prisma.familyMember.findMany({
    where: { ownerPatientId, ...(includeArchived ? {} : { archivedAt: null }) },
    select: MEMBER_SELECT,
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
}

export async function createFamilyMember(userId: string, input: CreateFamilyMemberInput) {
  const ownerPatientId = await requirePatientIdForUser(userId);
  // العدّ والإنشاء في معاملة واحدة مع قفل صف صاحب الحساب: طلبان متزامنان لا يتجاوزان الحد معًا.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "patients" WHERE "id" = ${ownerPatientId} FOR UPDATE`;
    const active = await tx.familyMember.count({ where: { ownerPatientId, archivedAt: null } });
    if (active >= MAX_ACTIVE_FAMILY_MEMBERS) {
      throw ApiError.badRequest(`لا يمكن إضافة أكثر من ${MAX_ACTIVE_FAMILY_MEMBERS} فردًا للحساب الواحد. يمكنك أرشفة فرد لم تعد تحجز له.`);
    }
    return tx.familyMember.create({
      data: {
        ownerPatientId,
        firstName: input.firstName,
        lastName: input.lastName,
        relationship: input.relationship,
        birthDate: input.birthDate ?? null,
        gender: input.gender ?? null,
      },
      select: MEMBER_SELECT,
    });
  });
}

export async function updateFamilyMember(userId: string, id: string, input: UpdateFamilyMemberInput) {
  const ownerPatientId = await requirePatientIdForUser(userId);
  const member = await findOwnedMember(ownerPatientId, id);
  if (member.archivedAt) throw ApiError.conflict("هذا الفرد مؤرشف ولا يمكن تعديله.");
  if (Object.keys(input).length === 0) throw ApiError.badRequest("لا توجد أي تغييرات لحفظها.");
  // updateMany بشرط الملكية نفسه: حتى لو تغيّر شيء بين القراءة والكتابة لا يُكتب على صف حساب آخر.
  const res = await prisma.familyMember.updateMany({
    where: { id, ownerPatientId, archivedAt: null },
    data: {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.relationship !== undefined ? { relationship: input.relationship } : {}),
      ...(input.birthDate !== undefined ? { birthDate: input.birthDate } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
    },
  });
  if (res.count !== 1) throw ApiError.conflict("تغيّرت بيانات هذا الفرد للتو. حدّث الصفحة وأعد المحاولة.");
  return findOwnedMember(ownerPatientId, id);
}

/** «حذف» = أرشفة. لا يحذف أي موعد ولا خطة علاج. تكرار الطلب لا يغيّر شيئًا (idempotent). */
export async function archiveFamilyMember(userId: string, id: string) {
  const ownerPatientId = await requirePatientIdForUser(userId);
  const member = await findOwnedMember(ownerPatientId, id);
  if (member.archivedAt) return member;
  await prisma.familyMember.updateMany({ where: { id, ownerPatientId, archivedAt: null }, data: { archivedAt: new Date() } });
  return findOwnedMember(ownerPatientId, id);
}
