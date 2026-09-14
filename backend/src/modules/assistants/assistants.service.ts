import crypto from "crypto";
import { InviteStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { hashPassword } from "../../utils/password";
import { hashToken } from "../../lib/tokens";
import { resolveActingDoctorId } from "../../lib/actingDoctor";

const INVITE_TTL_DAYS = 7;

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function inviteExpiryDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + INVITE_TTL_DAYS);
  return d;
}

/** طبيب فقط: إنشاء دعوة مساعد جديدة لبريد إلكتروني محدد. يُرجع الرمز الخام مرة واحدة فقط (لا يُخزَّن أبدًا). */
export async function createInvite(doctorUserId: string, email: string) {
  const doctorId = await resolveActingDoctorId(doctorUserId, Role.DOCTOR);

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) throw ApiError.conflict("هذا البريد الإلكتروني مستخدم بالفعل بحساب آخر على المنصة.");

  // دعوة معلّقة سابقة لنفس البريد عند نفس الطبيب: تُلغى وتُستبدل بدل تكديس دعوات صالحة متعددة لنفس البريد.
  await prisma.assistantInvite.updateMany({
    where: { doctorId, email, status: InviteStatus.PENDING },
    data: { status: InviteStatus.REVOKED, revokedAt: new Date() },
  });

  const rawToken = generateRawToken();
  const invite = await prisma.assistantInvite.create({
    data: { doctorId, email, tokenHash: hashToken(rawToken), expiresAt: inviteExpiryDate() },
  });

  return { invite, rawToken };
}

/** طبيب فقط: إعادة إرسال دعوة — رمز جديد وصلاحية جديدة لنفس السجل (لا تُنشئ دعوة موازية). */
export async function resendInvite(doctorUserId: string, inviteId: string) {
  const doctorId = await resolveActingDoctorId(doctorUserId, Role.DOCTOR);
  const invite = await prisma.assistantInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.doctorId !== doctorId) throw ApiError.notFound("الدعوة غير موجودة.");
  if (invite.status === InviteStatus.ACCEPTED) throw ApiError.badRequest("تم قبول هذه الدعوة بالفعل.");

  const rawToken = generateRawToken();
  const updated = await prisma.assistantInvite.update({
    where: { id: invite.id },
    data: { tokenHash: hashToken(rawToken), expiresAt: inviteExpiryDate(), status: InviteStatus.PENDING, revokedAt: null },
  });

  return { invite: updated, rawToken };
}

/** طبيب فقط: إلغاء دعوة معلّقة قبل قبولها. */
export async function revokeInvite(doctorUserId: string, inviteId: string) {
  const doctorId = await resolveActingDoctorId(doctorUserId, Role.DOCTOR);
  const invite = await prisma.assistantInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.doctorId !== doctorId) throw ApiError.notFound("الدعوة غير موجودة.");
  if (invite.status === InviteStatus.ACCEPTED) {
    throw ApiError.badRequest("تم قبول هذه الدعوة بالفعل، لا يمكن إلغاؤها — عطّل وصول المساعد بدل ذلك.");
  }

  return prisma.assistantInvite.update({
    where: { id: invite.id },
    data: { status: InviteStatus.REVOKED, revokedAt: new Date() },
  });
}

/** طبيب فقط: قائمة مساعديه الحاليين + دعواته المعلّقة/المنتهية معًا. */
export async function listAssistants(doctorUserId: string) {
  const doctorId = await resolveActingDoctorId(doctorUserId, Role.DOCTOR);

  const [assistants, invites] = await Promise.all([
    prisma.assistant.findMany({
      where: { doctorId },
      include: { user: { select: { email: true, isActive: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.assistantInvite.findMany({
      where: { doctorId, status: { in: [InviteStatus.PENDING, InviteStatus.EXPIRED] } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // دعوة انتهت صلاحيتها زمنيًا لكن لم تُحدَّث بعد في قاعدة البيانات — نعكس ذلك في القائمة المعروضة فقط دون كتابة هنا.
  const now = new Date();
  const invitesWithComputedStatus = invites.map((inv) => ({
    ...inv,
    status: inv.status === InviteStatus.PENDING && inv.expiresAt < now ? InviteStatus.EXPIRED : inv.status,
  }));

  return { assistants, invites: invitesWithComputedStatus };
}

/** طبيب فقط: تعطيل/تفعيل وصول مساعد — التعطيل يقطع الوصول فورًا من الـ Backend (انظر resolveActingDoctorId). */
export async function setAssistantActive(doctorUserId: string, assistantId: string, isActive: boolean) {
  const doctorId = await resolveActingDoctorId(doctorUserId, Role.DOCTOR);
  const assistant = await prisma.assistant.findUnique({ where: { id: assistantId } });
  if (!assistant || assistant.doctorId !== doctorId) throw ApiError.notFound("المساعد غير موجود.");

  return prisma.assistant.update({ where: { id: assistantId }, data: { isActive } });
}

/** عام (بدون مصادقة): تُستهلك من صفحة قبول الدعوة لعرض اسم الطبيب/العيادة قبل ملء النموذج. */
export async function getInviteByToken(rawToken: string) {
  const invite = await prisma.assistantInvite.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { doctor: { select: { firstName: true, lastName: true, clinic: { select: { nameAr: true } } } } },
  });
  if (!invite) throw ApiError.notFound("رابط الدعوة غير صالح.");
  if (invite.status === InviteStatus.REVOKED) throw ApiError.forbidden("تم إلغاء هذه الدعوة من طرف الطبيب.");
  if (invite.status === InviteStatus.ACCEPTED) throw ApiError.conflict("تم استعمال رابط الدعوة هذا مسبقًا. سجّل الدخول مباشرة.");

  const expired = invite.status === InviteStatus.EXPIRED || invite.expiresAt < new Date();
  if (expired) throw ApiError.forbidden("انتهت صلاحية رابط الدعوة. اطلب من الطبيب إرسال دعوة جديدة.");

  return {
    email: invite.email,
    doctorName: `${invite.doctor.firstName} ${invite.doctor.lastName}`,
    clinicName: invite.doctor.clinic?.nameAr ?? null,
  };
}

/**
 * عام (بدون مصادقة): تُستهلك من `POST /api/auth/register/assistant`. تتحقق من الرمز
 * مجددًا داخل معاملة واحدة (transaction) — الطبيب يُشتقّ من الدعوة نفسها فقط، ولا يمكن
 * اختيار الدور أو الطبيب المرتبط من جسم الطلب أبدًا. الدعوة تصبح ACCEPTED فورًا داخل
 * نفس المعاملة فلا يمكن استعمال نفس الرابط مرتين حتى في حال طلبين متزامنين.
 */
export async function acceptInvite(rawToken: string, data: { password: string; firstName: string; lastName: string }) {
  const tokenHash = hashToken(rawToken);

  return prisma.$transaction(async (tx) => {
    const invite = await tx.assistantInvite.findUnique({ where: { tokenHash } });
    if (!invite) throw ApiError.notFound("رابط الدعوة غير صالح.");
    if (invite.status === InviteStatus.REVOKED) throw ApiError.forbidden("تم إلغاء هذه الدعوة من طرف الطبيب.");
    if (invite.status === InviteStatus.ACCEPTED) throw ApiError.conflict("تم استعمال رابط الدعوة هذا مسبقًا.");
    if (invite.status === InviteStatus.EXPIRED || invite.expiresAt < new Date()) {
      throw ApiError.forbidden("انتهت صلاحية رابط الدعوة. اطلب من الطبيب إرسال دعوة جديدة.");
    }

    const existingUser = await tx.user.findUnique({ where: { email: invite.email } });
    if (existingUser) throw ApiError.conflict("هذا البريد الإلكتروني مسجّل بالفعل بحساب آخر.");

    const passwordHash = await hashPassword(data.password);
    const user = await tx.user.create({
      data: {
        email: invite.email,
        passwordHash,
        role: Role.ASSISTANT,
        assistant: {
          create: {
            doctorId: invite.doctorId,
            firstName: data.firstName,
            lastName: data.lastName,
          },
        },
      },
      include: { assistant: { include: { doctor: { include: { specialty: true, wilaya: true, city: true } } } } },
    });

    await tx.assistantInvite.update({
      where: { id: invite.id },
      data: { status: InviteStatus.ACCEPTED, acceptedAt: new Date() },
    });

    return user;
  });
}
