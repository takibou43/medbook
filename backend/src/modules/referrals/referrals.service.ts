import { safeErrorCode } from "../../lib/safeError";
import { Prisma, VerificationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { trialEndsAt } from "../../lib/trial";
import { writeAudit } from "../../lib/audit";
import { createNotification } from "../notifications/notifications.service";
import {
  computeReferralExtension,
  generateReferralCode,
  normalizeReferralCode,
  REFERRAL_REWARD_DAYS,
  REWARDABLE_STATUSES,
} from "./referrals.logic";

/**
 * «ادعُ طبيبًا واحصل على شهر»: المكافأة (30 يومًا) للطبيب المُحيل فقط، مرة واحدة، عند التوثيق الفعلي
 * (VERIFIED) للطبيب المُحال — لا عند التسجيل.
 *
 * منع تكرار المكافأة (طبقات):
 *  1) referredDoctorId فريد في doctor_referrals: الطبيب المُحال يُحتسب مرة واحدة فقط مدى الحياة.
 *  2) المنح داخل نفس معاملة تغيير verificationStatus، مع قفل صف الطبيب المُحيل (FOR UPDATE).
 *  3) compare-and-swap: تحويل الإحالة إلى REWARDED بـupdateMany مشروط بحالة غير REWARDED — المعاملة
 *     الثانية (إعادة التوثيق، نقرة مزدوجة، طلبان متزامنان) تجد count = 0 فلا تمدّد شيئًا.
 *  4) التمديد وتحويل الحالة وسطر AuditLog في نفس المعاملة: فشل أي خطوة يُرجع الكل (لا REWARDED بلا تمديد).
 */

export const INVALID_REFERRAL_MESSAGE = "كود الإحالة غير صحيح. صحّحه أو احذفه لإكمال التسجيل.";

function invalidReferralError() {
  return ApiError.badRequest(INVALID_REFERRAL_MESSAGE, { field: "referralCode", code: "INVALID_REFERRAL_CODE" });
}

async function doctorIdForUser(userId: string): Promise<string> {
  const d = await prisma.doctor.findUnique({ where: { userId }, select: { id: true } });
  if (!d) throw ApiError.notFound("لم يتم العثور على ملف طبيب مرتبط بهذا الحساب.");
  return d.id;
}

/** كود الطبيب — يُولَّد عند أول طلب (الأطباء القدامى بلا كود). تعارض نادر جدًا → إعادة توليد. */
export async function getOrCreateReferralCode(doctorId: string): Promise<string> {
  const existing = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { referralCode: true } });
  if (!existing) throw ApiError.notFound("الطبيب غير موجود.");
  if (existing.referralCode) return existing.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      // لا نكتب فوق كود موجود (طلبان متزامنان): الشرط referralCode = null.
      const r = await prisma.doctor.updateMany({ where: { id: doctorId, referralCode: null }, data: { referralCode: code } });
      if (r.count === 1) return code;
      const again = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { referralCode: true } });
      if (again?.referralCode) return again.referralCode;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  throw ApiError.unavailable("تعذّر إنشاء كود الإحالة الآن. أعد المحاولة بعد لحظات.");
}

/** GET /api/doctor/referrals/me — الكود + الإحالات بحالاتها. الطبيب يرى إحالاته هو فقط. */
export async function getMyReferrals(userId: string) {
  const doctorId = await doctorIdForUser(userId);
  const code = await getOrCreateReferralCode(doctorId);
  const referrals = await prisma.doctorReferral.findMany({
    where: { referrerDoctorId: doctorId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      qualifiedAt: true,
      rewardedAt: true,
      rewardDays: true,
      // الطبيب المُحال: الاسم الأول والحرف الأول من اللقب فقط (قد لا يكون ملفه منشورًا بعد).
      referred: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    code,
    rewardDays: REFERRAL_REWARD_DAYS,
    referrals: referrals.map(({ referred, ...r }) => ({
      ...r,
      referredName: `د. ${referred.firstName} ${referred.lastName ? referred.lastName.charAt(0) + "." : ""}`.trim(),
    })),
    totals: {
      pending: referrals.filter((r) => r.status === "PENDING" || r.status === "REJECTED").length,
      rewarded: referrals.filter((r) => r.status === "REWARDED").length,
      rewardedDays: referrals.filter((r) => r.status === "REWARDED").reduce((s, r) => s + r.rewardDays, 0),
    },
  };
}

/** التحقق العام من كود قبل التسجيل — يعيد صلاحيته فقط، بلا اسم الطبيب ولا أي معرّف. */
export async function validateReferralCode(raw: string): Promise<{ valid: boolean }> {
  const code = normalizeReferralCode(raw);
  if (!code) return { valid: false };
  const d = await prisma.doctor.findUnique({ where: { referralCode: code }, select: { id: true } });
  return { valid: Boolean(d) };
}

/**
 * يُستدعى من تسجيل الطبيب قبل الإنشاء: كود فارغ = لا إحالة. كود غير صحيح → 400 مرتبط بالحقل
 * (لا يُنشأ الحساب، ويطلب من الطبيب تصحيح الكود أو حذفه — التسجيل بلا كود متاح دائمًا).
 */
export async function resolveReferrerForRegistration(raw: string | null | undefined): Promise<{ referrerDoctorId: string; code: string } | null> {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const code = normalizeReferralCode(raw);
  if (!code) throw invalidReferralError();
  const d = await prisma.doctor.findUnique({ where: { referralCode: code }, select: { id: true } });
  if (!d) throw invalidReferralError();
  return { referrerDoctorId: d.id, code };
}

/** إنشاء سجل الإحالة داخل معاملة التسجيل نفسها. لا إحالة ذاتية (قيد CHECK أيضًا في قاعدة البيانات). */
export async function createReferralTx(
  tx: Prisma.TransactionClient,
  referrer: { referrerDoctorId: string; code: string },
  referredDoctorId: string
) {
  if (referrer.referrerDoctorId === referredDoctorId) throw invalidReferralError();
  return tx.doctorReferral.create({
    data: {
      referrerDoctorId: referrer.referrerDoctorId,
      referredDoctorId,
      referralCodeUsed: referrer.code,
      rewardDays: REFERRAL_REWARD_DAYS,
    },
  });
}

export interface GrantedReward {
  referralId: string;
  referrerDoctorId: string;
  referrerUserId: string;
  previousExpiresAt: Date | null;
  newExpiresAt: Date;
}

/**
 * منح المكافأة داخل معاملة التوثيق. يعيد null إن لم توجد إحالة أو مُنحت سابقًا.
 * آمن لإعادة التشغيل: أي تنفيذ ثانٍ لا يجد إحالة قابلة للمكافأة فلا يضيف يومًا واحدًا.
 */
export async function grantReferralRewardTx(
  tx: Prisma.TransactionClient,
  referredDoctorId: string,
  actorUserId: string | null,
  now: Date = new Date()
): Promise<GrantedReward | null> {
  const referral = await tx.doctorReferral.findUnique({ where: { referredDoctorId } });
  if (!referral || referral.status === "REWARDED") return null;

  // قفل صف المُحيل: منحان متزامنان لنفس المُحيل (إحالتان مختلفتان) لا يقرآن نفس تاريخ الانتهاء القديم.
  await tx.$executeRaw`SELECT 1 FROM "doctors" WHERE "id" = ${referral.referrerDoctorId} FOR UPDATE`;

  const swapped = await tx.doctorReferral.updateMany({
    where: { id: referral.id, status: { in: [...REWARDABLE_STATUSES] } },
    data: { status: "REWARDED", qualifiedAt: referral.qualifiedAt ?? now, rewardedAt: now },
  });
  if (swapped.count !== 1) return null;

  const referrer = await tx.doctor.findUnique({
    where: { id: referral.referrerDoctorId },
    select: { id: true, userId: true, subscriptionStatus: true, subscriptionExpiresAt: true },
  });
  if (!referrer) throw ApiError.notFound("الطبيب المُحيل غير موجود.");

  const newExpiresAt = computeReferralExtension(referrer, now, trialEndsAt(), referral.rewardDays);
  await tx.doctor.update({
    where: { id: referrer.id },
    data: { subscriptionStatus: "ACTIVE", subscriptionExpiresAt: newExpiresAt },
  });

  await writeAudit(
    {
      userId: actorUserId,
      action: "REFERRAL_REWARDED",
      entity: "DoctorReferral",
      entityId: referral.id,
      meta: {
        referrerDoctorId: referrer.id,
        referredDoctorId,
        rewardDays: referral.rewardDays,
        previousStatus: referrer.subscriptionStatus,
        previousExpiresAt: referrer.subscriptionExpiresAt?.toISOString() ?? null,
        newExpiresAt: newExpiresAt.toISOString(),
      },
    },
    tx
  );

  return {
    referralId: referral.id,
    referrerDoctorId: referrer.id,
    referrerUserId: referrer.userId,
    previousExpiresAt: referrer.subscriptionExpiresAt,
    newExpiresAt,
  };
}

/**
 * تغيير توثيق الطبيب (المسار الوحيد الموجود: PATCH /api/admin/doctors/:id/verify) + الإحالة في معاملة واحدة.
 *  - VERIFIED: منح المكافأة للمُحيل (مرة واحدة).
 *  - REJECTED: إحالة PENDING تصبح REJECTED (تبقى قابلة للمكافأة إن وُثّق لاحقًا فعلًا).
 */
/**
 * منطق الإحالة عند تغيير التوثيق، داخل معاملة يملكها المستدعي (admin.setDoctorVerification يجمعه
 * مع إشعار «طبيب جديد في ولايتك» في معاملة واحدة).
 */
export async function applyReferralOnVerificationTx(
  tx: Prisma.TransactionClient,
  doctorId: string,
  status: VerificationStatus,
  actorUserId: string | null,
  now: Date = new Date()
): Promise<GrantedReward | null> {
  if (status === VerificationStatus.VERIFIED) {
    return grantReferralRewardTx(tx, doctorId, actorUserId, now);
  }
  if (status === VerificationStatus.REJECTED) {
    await tx.doctorReferral.updateMany({ where: { referredDoctorId: doctorId, status: "PENDING" }, data: { status: "REJECTED" } });
  }
  return null;
}

export async function setVerificationWithReferral(doctorId: string, status: VerificationStatus, actorUserId: string | null) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const doctor = await tx.doctor.update({
      where: { id: doctorId },
      data: { verificationStatus: status },
      include: { user: { select: { email: true, phone: true, isActive: true } } },
    });
    const reward = await applyReferralOnVerificationTx(tx, doctorId, status, actorUserId, now);
    return { doctor, reward };
  });
}

/** إشعار المُحيل بعد نجاح المعاملة فقط (فشل الإشعار لا يلغي المكافأة المحفوظة). */
export async function notifyReferrerRewarded(reward: GrantedReward) {
  try {
    await createNotification(
      reward.referrerUserId,
      "REFERRAL_REWARDED",
      "تمت إضافة 30 يومًا لاشتراكك",
      `شكرًا على دعوة زميلك إلى MedBook! تم توثيق حسابه، وأُضيف ${REFERRAL_REWARD_DAYS} يومًا إلى اشتراكك حتى ${reward.newExpiresAt.toISOString().slice(0, 10)}.`
    );
  } catch (err) {
    console.error("تعذّر إشعار الطبيب المُحيل (المكافأة محفوظة):", safeErrorCode(err));
  }
}

/** GET /api/admin/referrals — عرض فقط، بلا أي زر مكافأة يدوي. */
export async function listReferralsAdmin(params: { status?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const where = params.status ? { status: params.status as any } : {};
  const [items, total] = await Promise.all([
    prisma.doctorReferral.findMany({
      where,
      select: {
        id: true,
        status: true,
        referralCodeUsed: true,
        rewardDays: true,
        createdAt: true,
        qualifiedAt: true,
        rewardedAt: true,
        referrer: { select: { id: true, firstName: true, lastName: true, subscriptionStatus: true, subscriptionExpiresAt: true } },
        referred: { select: { id: true, firstName: true, lastName: true, verificationStatus: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.doctorReferral.count({ where }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
