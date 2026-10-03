import { Prisma, Role, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { comparePassword } from "../../utils/password";
import { writeAudit } from "../../lib/audit";
import { issueTokens } from "../../lib/tokens";
import { PROFILE_PROBE, summarizeProfiles, canHoldBothProfiles } from "../../lib/accountProfiles";
import { resolveReferrerForRegistration, createReferralTx } from "../referrals/referrals.service";
import { AddPatientProfileInput, ApplyDoctorProfileInput } from "./auth.schema";

/**
 * إضافة الملف الثاني لحساب قائم (بلا إنشاء حساب آخر ولا تغيير للبريد/الهاتف/كلمة المرور):
 *   - addPatientProfile: طبيب يفعّل ملف مريض.
 *   - applyAsDoctor:     مريض يقدّم طلب طبيب (يبقى قيد المراجعة PENDING؛ لا اعتماد تلقائي).
 *
 * القواعد المشتركة:
 *   1) الجلسة الحالية تحدد الحساب (userId من التوكن لا من الجسم) ولا يُقبل أي معرّف حساب من العميل.
 *   2) كلمة المرور الحالية مطلوبة من جديد (إثبات حضور)، وخطأها 403 لا 401 كي لا تُشغَّل إعادة المحاولة بالتجديد.
 *   3) الأدوار الأخرى (إدارة/مساعد/مالك عيادة) لا تملك هذا المسار.
 *   4) لا تكرار: الإنشاء داخل معاملة، والقيدان الفريدان على Patient.userId وDoctor.userId هما الحارس النهائي
 *      للطلبات المتزامنة (الخاسر يحصل على نتيجة الفائز دون خطأ في تفعيل الملف، و409 واضح في طلب الطبيب).
 *   5) لا يغيّر شيئًا من الملف الأول ولا من دور الحساب (User.role) ولا من اشتراكه أو ارتباطه بالعيادة أو مواعيده.
 */

async function requireOwnerWithPassword(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, passwordHash: true, ...PROFILE_PROBE } });
  if (!user || !user.isActive) throw ApiError.unauthorized();
  if (!canHoldBothProfiles(user.role)) throw ApiError.forbidden();
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw ApiError.forbidden("كلمة المرور غير صحيحة.");
  return user;
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function addPatientProfile(userId: string, input: AddPatientProfileInput) {
  const user = await requireOwnerWithPassword(userId, input.password);
  if (user.role !== Role.DOCTOR) throw ApiError.forbidden("تفعيل ملف المريض متاح لحسابات الأطباء فقط.");

  if (input.cityId) {
    const city = await prisma.city.findUnique({ where: { id: input.cityId }, select: { id: true } });
    if (!city) throw ApiError.badRequest("البلدية المختارة غير موجودة.");
  }

  let created = false;
  if (!user.patient) {
    const doctor = await prisma.doctor.findUnique({ where: { userId }, select: { firstName: true, lastName: true } });
    if (!doctor) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
    try {
      await prisma.$transaction(async (tx) => {
        await tx.patient.create({
          data: {
            userId,
            firstName: input.firstName ?? doctor.firstName,
            lastName: input.lastName ?? doctor.lastName,
            cityId: input.cityId ?? null,
          },
        });
        await writeAudit({ userId, action: "PROFILE_PATIENT_ACTIVATED", entity: "User", entityId: userId }, tx);
      });
      created = true;
    } catch (err) {
      // طلب متزامن فعّل الملف قبلنا: النتيجة المطلوبة تحققت، فلا خطأ ولا ملف مكرر.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  const tokens = await issueTokens(userId, Role.PATIENT);
  return { created, ...tokens };
}

export async function applyAsDoctor(userId: string, input: ApplyDoctorProfileInput) {
  const user = await requireOwnerWithPassword(userId, input.password);
  if (user.role !== Role.PATIENT) throw ApiError.forbidden("تقديم طلب الطبيب متاح لحسابات المرضى فقط.");
  if (user.doctor) {
    throw ApiError.conflict("لديك طلب أو ملف طبيب مرتبط بهذا الحساب بالفعل.", { code: "DOCTOR_PROFILE_EXISTS", status: user.doctor.verificationStatus });
  }

  // كود الإحالة يُفحص قبل أي إنشاء (كما في تسجيل الطبيب الجديد).
  const referrer = await resolveReferrerForRegistration(input.referralCode);

  try {
    await prisma.$transaction(async (tx) => {
      const doctor = await tx.doctor.create({
        data: {
          userId,
          firstName: input.firstName,
          lastName: input.lastName,
          specialtyId: input.specialtyId,
          wilayaId: input.wilayaId,
          cityId: input.cityId,
          bio: input.bio,
          yearsExperience: input.yearsExperience ?? 0,
          languages: input.languages ?? ["العربية"],
          gender: input.gender,
          consultationFee: input.consultationFee,
          // نفس قواعد تسجيل الطبيب الجديد: لا ظهور للمرضى ولا اعتماد قبل مراجعة الإدارة.
          verificationStatus: VerificationStatus.PENDING,
          newDoctorTrial: true,
        },
      });
      if (referrer) await createReferralTx(tx, referrer, doctor.id);
      await writeAudit({ userId, action: "PROFILE_DOCTOR_APPLIED", entity: "Doctor", entityId: doctor.id }, tx);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw ApiError.conflict("لديك طلب أو ملف طبيب مرتبط بهذا الحساب بالفعل.", { code: "DOCTOR_PROFILE_EXISTS" });
    }
    throw err;
  }

  // يبقى سياق الجلسة الحالي كما هو (مريض). سياق الطبيب يُنشأ عند الانتقال/الدخول إلى لوحة الأطباء.
  const tokens = await issueTokens(userId, Role.DOCTOR);
  return { ...tokens };
}

/** ملخص الملفين الحالي للحساب (لعرضه في الواجهتين بعد أي تغيير). */
export async function profilesFor(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, ...PROFILE_PROBE } });
  if (!user) throw ApiError.notFound("الحساب غير موجود.");
  return summarizeProfiles(user);
}

/** إصدار جلسة لواجهة الأطباء من واجهة المرضى (يتحقق من وجود ملف الطبيب فعلًا). */
export async function issueDoctorPortalSession(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, doctor: { select: { id: true } } } });
  if (!user || !user.isActive) throw ApiError.unauthorized();
  if (!canHoldBothProfiles(user.role) || !user.doctor) throw ApiError.forbidden("لا يوجد ملف طبيب مرتبط بهذا الحساب.");
  return issueTokens(userId, Role.DOCTOR);
}

/** إصدار جلسة لواجهة المرضى من لوحة الأطباء (يتحقق من وجود ملف المريض فعلًا). */
export async function issuePatientPortalSession(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, patient: { select: { id: true } } } });
  if (!user || !user.isActive) throw ApiError.unauthorized();
  if (!canHoldBothProfiles(user.role) || !user.patient) throw ApiError.forbidden("لا يوجد ملف مريض مرتبط بهذا الحساب.");
  return issueTokens(userId, Role.PATIENT);
}
