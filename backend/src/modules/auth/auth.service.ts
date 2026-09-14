import { Role, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { hashPassword, comparePassword } from "../../utils/password";
import { verifyRefreshToken } from "../../utils/jwt";
import { ApiError } from "../../utils/ApiError";
import { RegisterDoctorInput, RegisterPatientInput, RegisterAssistantInput } from "./auth.schema";
import { hashToken, issueTokens } from "../../lib/tokens";
import { acceptInvite } from "../assistants/assistants.service";
import { ASSISTANT_SAFE_SELECT } from "../../lib/assistantView";

export async function registerPatient(input: RegisterPatientInput) {
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { phone: input.phone ?? undefined }] } });
  if (existing) throw ApiError.conflict("البريد الإلكتروني أو رقم الهاتف مستخدم مسبقًا.");

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: Role.PATIENT,
      patient: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          birthDate: input.birthDate,
          gender: input.gender,
          cityId: input.cityId,
        },
      },
    },
    include: { patient: true },
  });

  const tokens = await issueTokens(user.id, user.role);
  return { user, ...tokens };
}

export async function registerDoctor(input: RegisterDoctorInput) {
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { phone: input.phone ?? undefined }] } });
  if (existing) throw ApiError.conflict("البريد الإلكتروني أو رقم الهاتف مستخدم مسبقًا.");

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: Role.DOCTOR,
      doctor: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          specialtyId: input.specialtyId,
          wilayaId: input.wilayaId,
          cityId: input.cityId,
          clinicId: input.clinicId,
          bio: input.bio,
          yearsExperience: input.yearsExperience ?? 0,
          languages: input.languages ?? ["العربية"],
          gender: input.gender,
          consultationFee: input.consultationFee,
          verificationStatus: VerificationStatus.PENDING, // يجب أن تتحقق الإدارة من الطبيب أولًا
        },
      },
    },
    include: { doctor: true },
  });

  const tokens = await issueTokens(user.id, user.role);
  return { user, ...tokens };
}

/**
 * تسجيل حساب مساعد بعد قبول دعوة صالحة. كل التحقق من الرمز/البريد/الطبيب يتم داخل
 * assistants.service.acceptInvite (معاملة واحدة) — هذه الدالة فقط تُصدر التوكنات بعدها
 * بنفس آلية بقية عمليات التسجيل.
 */
export async function registerAssistant(input: RegisterAssistantInput) {
  const user = await acceptInvite(input.token, {
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
  });

  const tokens = await issueTokens(user.id, user.role);
  return { user, ...tokens };
}

export async function login(email: string, password: string) {
  // نُضمّن assistant (بنفس ASSISTANT_SAFE_SELECT المستعمل في getMe/acceptInvite) حتى تصل
  // بيانات الطبيب الآمنة للمساعد ضمن استجابة تسجيل الدخول نفسها، دون الاعتماد على استدعاء
  // /auth/me لاحقًا لإظهارها — لا تسريب: نفس الثابت المُدقَّق مسبقًا هو ما يُستعمل هنا أيضًا.
  const user = await prisma.user.findUnique({
    where: { email },
    include: { patient: true, doctor: true, assistant: ASSISTANT_SAFE_SELECT },
  });
  if (!user) throw ApiError.unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  if (!user.isActive) throw ApiError.forbidden("هذا الحساب معطّل. تواصل مع الإدارة.");

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة.");

  const tokens = await issueTokens(user.id, user.role);
  return { user, ...tokens };
}

/**
 * تحديث بيانات حساب المستخدم الحالي (البريد و/أو كلمة المرور).
 * نشترط كلمة المرور الحالية دائمًا حتى لا يستطيع أحد استغلال جلسة مسروقة لتغيير بيانات الدخول،
 * ونُبطل كل جلسات التحديث (refresh tokens) بعد تغيير كلمة المرور لإخراج أي جلسة أخرى.
 */
export async function updateAccount(
  userId: string,
  input: { currentPassword: string; email?: string; newPassword?: string }
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("الحساب غير موجود.");

  const valid = await comparePassword(input.currentPassword, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("كلمة المرور الحالية غير صحيحة.");

  const data: { email?: string; passwordHash?: string } = {};

  if (input.email && input.email !== user.email) {
    const taken = await prisma.user.findUnique({ where: { email: input.email } });
    if (taken) throw ApiError.conflict("البريد الإلكتروني مستخدم مسبقًا.");
    data.email = input.email;
  }

  if (input.newPassword) {
    data.passwordHash = await hashPassword(input.newPassword);
  }

  if (!data.email && !data.passwordHash) {
    throw ApiError.badRequest("لا يوجد أي تغيير لحفظه.");
  }

  const updated = await prisma.user.update({ where: { id: userId }, data });

  if (data.passwordHash) {
    await prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
  }

  return updated;
}

export async function refresh(refreshToken: string) {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized("جلسة منتهية. الرجاء تسجيل الدخول من جديد.");
  }

  const stored = await prisma.refreshToken.findFirst({
    where: { userId: decoded.sub, tokenHash: hashToken(refreshToken), revoked: false },
  });
  if (!stored || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized("جلسة منتهية. الرجاء تسجيل الدخول من جديد.");
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user || !user.isActive) throw ApiError.unauthorized();

  // rotate: revoke old, issue new
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const tokens = await issueTokens(user.id, user.role);
  return { user, ...tokens };
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken) },
    data: { revoked: true },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      patient: true,
      // الطبيب يرى سجلّه الكامل (كما كان دائمًا) — هذا حسابه هو نفسه.
      doctor: { include: { specialty: true, wilaya: true, city: true } },
      // المساعد: نحتاج فقط عرض اسم الطبيب/العيادة (شارة "مساعد لدى د. ...") ورابط الحجز
      // العام لطباعته — ثابت مشترك (ASSISTANT_SAFE_SELECT) يُستخدم هنا وفي acceptInvite
      // حتى لا يتكرر نفس خطأ include/select في مكان ولا يُصحَّح في الآخر.
      assistant: ASSISTANT_SAFE_SELECT,
    },
  });
  if (!user) throw ApiError.notFound("المستخدم غير موجود.");
  return user;
}
