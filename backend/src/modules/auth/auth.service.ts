import { resolveSpecialtyId } from "../../lib/specialtySelection";
import { Role, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { hashPassword, comparePassword, getDummyPasswordHash } from "../../utils/password";
import { verifyRefreshToken } from "../../utils/jwt";
import { ApiError } from "../../utils/ApiError";
import { RegisterDoctorInput, RegisterPatientInput, RegisterAssistantInput } from "./auth.schema";
import { hashToken, issueTokens } from "../../lib/tokens";
import { acceptInvite } from "../assistants/assistants.service";
import { ASSISTANT_SAFE_SELECT } from "../../lib/assistantView";
import { assistantDoctorContext } from "../../lib/assistantDoctorContext";
import { assistantDoctorWhere } from "../../lib/assistantScope";
import { resolveReferrerForRegistration, createReferralTx } from "../referrals/referrals.service";
import { doctorPortalRole, summarizeProfiles, PROFILE_PROBE, accountExistsError } from "../../lib/accountProfiles";


export async function registerPatient(input: RegisterPatientInput) {
  // بلا هاتف: لا نضيف شرط الهاتف إطلاقًا ({ phone: undefined } يطابق كل المستخدمين فيرفض أي تسجيل بلا هاتف بـ409).
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])] } });
  if (existing) throw accountExistsError();

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
  if (input.clinicId) throw ApiError.forbidden("الانضمام إلى العيادة يتطلب دعوة من صاحبها.");
  // بلا هاتف: لا نضيف شرط الهاتف إطلاقًا ({ phone: undefined } يطابق كل المستخدمين فيرفض أي تسجيل بلا هاتف بـ409).
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])] } });
  if (existing) throw accountExistsError();

  // كود الإحالة يُفحص قبل أي إنشاء: كود غير صحيح → 400 على الحقل referralCode ولا يُنشأ الحساب.
  const referrer = await resolveReferrerForRegistration(input.referralCode);

  const passwordHash = await hashPassword(input.password);

  // الحساب + ملف الطبيب + سجل الإحالة (PENDING) في معاملة واحدة. لا مكافأة عند التسجيل: تُمنح للمُحيل
  // عند توثيق هذا الطبيب فعليًا (referrals.service). المُحيل لا يتغيّر بعد الإنشاء (لا مسار لذلك).
  const user = await prisma.$transaction(async (tx) => {
    const specialtyId = await resolveSpecialtyId(tx, input);
    const created = await tx.user.create({
    data: {
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: Role.DOCTOR,
      doctor: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          specialtyId,
          wilayaId: input.wilayaId,
          cityId: input.cityId,
          clinicId: input.clinicId,
          bio: input.bio,
          yearsExperience: input.yearsExperience ?? 0,
          languages: input.languages ?? ["العربية"],
          gender: input.gender,
          consultationFee: input.consultationFee,
          verificationStatus: VerificationStatus.PENDING, // يجب أن تتحقق الإدارة من الطبيب أولًا
          newDoctorTrial: true,
        },
      },
    },
    include: { doctor: true },
    });
    if (referrer && created.doctor) await createReferralTx(tx, referrer, created.doctor.id);
    return created;
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
    include: { patient: true, doctor: { include: { clinic: true } }, assistant: ASSISTANT_SAFE_SELECT, ownedClinic: true },
  });
  const valid = await comparePassword(password, user?.passwordHash ?? await getDummyPasswordHash());
  if (!user || !valid) throw ApiError.unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  if (!user.isActive) throw ApiError.forbidden("هذا الحساب معطّل. تواصل مع الإدارة.");

  // سياق واجهة الأطباء: مريض يملك ملف طبيب يدخل كطبيب؛ وغيره بدوره الأصلي كما كان.
  const context = doctorPortalRole(user);
  const tokens = await issueTokens(user.id, context);
  return { user: user.role === Role.ASSISTANT ? await getMe(user.id, context) : { ...user, role: context, profiles: summarizeProfiles(user) }, ...tokens };
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

  const newEmail = input.email?.trim();
  if (newEmail && newEmail.toLowerCase() !== user.email.toLowerCase()) {
    // حل مؤقت آمن إلى حين توفّر تحقق بالبريد (رابط تأكيد) ضمن الخدمات المجانية:
    // - كلمة المرور الحالية مطلوبة دائمًا (فُحصت أعلاه) + حدّ محاولات صارم على المسار.
    // - حسابات الإدارة لا يُغيَّر بريدها من هنا إطلاقًا (أعلى صلاحية = أعلى خطر استيلاء).
    // - تغيير البريد يُبطل كل جلسات التحديث، فتخرج أي جلسة أخرى مفتوحة على الحساب.
    if (user.role === Role.ADMIN) {
      throw ApiError.forbidden("لا يمكن تغيير البريد الإلكتروني لحساب الإدارة من هنا.");
    }
    const taken = await prisma.user.findFirst({
      where: { email: { equals: newEmail, mode: "insensitive" }, NOT: { id: user.id } },
      select: { id: true },
    });
    if (taken) throw ApiError.conflict("البريد الإلكتروني مستخدم مسبقًا.");
    data.email = newEmail;
  }

  if (input.newPassword) {
    data.passwordHash = await hashPassword(input.newPassword);
  }

  if (!data.email && !data.passwordHash) {
    throw ApiError.badRequest("لا يوجد أي تغيير لحفظه.");
  }

  const updated = await prisma.user.update({ where: { id: userId }, data });

  const sessionsRevoked = !!(data.passwordHash || data.email);
  if (sessionsRevoked) {
    await prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
  }

  return { user: updated, sessionsRevoked };
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

  const user = await prisma.user.findUnique({ where: { id: decoded.sub }, include: PROFILE_PROBE });
  if (!user || !user.isActive) throw ApiError.unauthorized();

  // rotate: revoke old, issue new
  const consumed = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revoked: false, expiresAt: { gt: new Date() } },
    data: { revoked: true },
  });
  if (consumed.count !== 1) throw ApiError.unauthorized("جلسة منتهية. الرجاء تسجيل الدخول من جديد.");
  const context = doctorPortalRole(user);
  const tokens = await issueTokens(user.id, context);
  const { patient: _p, doctor: _d, ...rest } = user;
  void _p; void _d;
  return { user: { ...rest, role: context, profiles: summarizeProfiles(user) }, ...tokens };
}

/**
 * allSessions: إبطال كل جلسات التجديد للحساب (واجهة المرضى والأطباء معًا) — يُستعمل لحساب الملفين
 * حتى لا تبقى جلسة الواجهة الأخرى مفتوحة بعد الخروج. لا يُنفَّذ إلا إن طابق الكوكي المُرسَل جلسة قائمة فعلًا.
 */
export async function logout(refreshToken: string | undefined, allSessions = false) {
  if (!refreshToken) return;
  const tokenHash = hashToken(refreshToken);
  if (allSessions) {
    const row = await prisma.refreshToken.findFirst({ where: { tokenHash }, select: { userId: true } });
    if (row) {
      await prisma.refreshToken.updateMany({ where: { userId: row.userId, revoked: false }, data: { revoked: true } });
      return;
    }
  }
  await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revoked: true } });
}

export async function getMe(userId: string, context?: Role) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      patient: true,
      ownedClinic: true,
      // الطبيب يرى سجلّه الكامل (كما كان دائمًا) — هذا حسابه هو نفسه.
      doctor: { include: { specialty: true, wilaya: true, city: true, clinic: true } },
      // المساعد: نحتاج فقط عرض اسم الطبيب/العيادة (شارة "مساعد لدى د. ...") ورابط الحجز
      // العام لطباعته — ثابت مشترك (ASSISTANT_SAFE_SELECT) يُستخدم هنا وفي acceptInvite
      // حتى لا يتكرر نفس خطأ include/select في مكان ولا يُصحَّح في الآخر.
      assistant: ASSISTANT_SAFE_SELECT,
    },
  });
  if (!user) throw ApiError.notFound("المستخدم غير موجود.");
  // role = سياق الجلسة الحالية (الواجهة التي دخل منها)؛ دور الحساب الأصلي لا يُكشف ولا يتغيّر في القاعدة.
  const selectedDoctor = assistantDoctorContext.getStore();
  if (user.role === Role.ASSISTANT && user.assistant?.isActive) {
    const doctor = await prisma.doctor.findFirst({
      where: { AND: [assistantDoctorWhere(user.assistant), ...(selectedDoctor ? [{ id: selectedDoctor }] : [])] },
      select: ASSISTANT_SAFE_SELECT.select.doctor.select,
      orderBy: { id: "asc" },
    });
    if (doctor) user.assistant.doctor = doctor;
  }
  return { ...user, role: context ?? user.role, profiles: summarizeProfiles(user) };
}
