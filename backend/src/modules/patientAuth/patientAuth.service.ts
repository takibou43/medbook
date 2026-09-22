import { Prisma, Role, AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { hashPassword, comparePassword } from "../../utils/password";
import { verifyRefreshToken } from "../../utils/jwt";
import { ApiError } from "../../utils/ApiError";
import { hashToken, issueTokens } from "../../lib/tokens";
import { sendPushToUser, isPushEnabled } from "../../lib/push";
import { PatientRegisterInput, PushSubscriptionInput } from "./patientAuth.schema";
import { isPatientBlocked } from "../patientBlocks/patientBlocks.service";

/**
 * حساب المريض — يعيد استعمال البنية الموجودة كما هي (لا نظام ثانٍ):
 *   User(role = PATIENT) + Patient (1:1)، bcrypt للتجزئة (utils/password)، JWT access + refresh
 *   مُجزّأ ومُدوَّر في جدول RefreshToken (lib/tokens). الفرق الوحيد عن /api/auth أن هذه المسارات
 *   مقصورة على دور المريض (طبيب/مساعد/إدارة لا يدخلون من هنا) وأن البريد يُطبَّع دائمًا.
 */

// الحقول الآمنة فقط — لا passwordHash ولا أي حقل داخلي آخر يخرج من هذه الوحدة أبدًا.
export const PATIENT_ME_SELECT = {
  id: true,
  email: true,
  phone: true,
  role: true,
  createdAt: true,
  patient: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.UserSelect;

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? full.trim(), lastName: parts.slice(1).join(" ") };
}

export async function registerPatientAccount(input: PatientRegisterInput) {
  // البحث غير حساس لحالة الأحرف لأن حسابات قديمة قد تكون حُفظت ببريد غير مُطبَّع.
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: input.email, mode: "insensitive" } },
        ...(input.phone ? [{ phone: input.phone }] : []),
      ],
    },
    select: { id: true },
  });
  if (existing) throw ApiError.conflict("البريد الإلكتروني أو رقم الهاتف مستخدم مسبقًا.");

  const passwordHash = await hashPassword(input.password);
  const { firstName, lastName } = splitName(input.name);

  // سباق طلبين متزامنين بنفس البريد: القيد الفريد users.email يرفض الثاني (P2002 → 409 في errorHandler).
  const user = await prisma.user.create({
    data: {
      email: input.email,
      phone: input.phone ?? null,
      passwordHash,
      role: Role.PATIENT,
      patient: { create: { firstName, lastName } },
    },
    select: PATIENT_ME_SELECT,
  });

  const tokens = await issueTokens(user.id, user.role);
  // حساب جديد لا يمكن أن يكون محظورًا.
  return { user: { ...user, isBlocked: false }, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

// تجزئة وهمية ثابتة تُقارَن عند عدم وجود الحساب، فيستغرق الرد نفس الوقت تقريبًا في الحالتين
// ولا يكشف التوقيت إن كان البريد مسجَّلًا.
let dummyHash: Promise<string> | null = null;
function getDummyHash() {
  if (!dummyHash) dummyHash = hashPassword("medbook-timing-equalizer-not-a-real-password");
  return dummyHash;
}

export async function loginPatient(email: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, role: Role.PATIENT },
    select: { id: true, role: true, isActive: true, passwordHash: true },
  });

  const valid = await comparePassword(password, user?.passwordHash ?? (await getDummyHash()));
  // نفس الرسالة لبريد غير موجود/كلمة خاطئة/حساب ليس مريضًا — لا تعداد للحسابات.
  if (!user || !valid) throw ApiError.unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  if (!user.isActive) throw ApiError.forbidden("هذا الحساب معطّل. تواصل مع الإدارة.");

  const tokens = await issueTokens(user.id, user.role);
  const me = await getPatientMe(user.id);
  return { user: me, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

export async function refreshPatientSession(refreshToken: string | undefined) {
  const expired = () => ApiError.unauthorized("جلسة منتهية. الرجاء تسجيل الدخول من جديد.");
  if (!refreshToken) throw expired();

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw expired();
  }

  const stored = await prisma.refreshToken.findFirst({
    where: { userId: decoded.sub, tokenHash: hashToken(refreshToken), revoked: false },
  });
  if (!stored || stored.expiresAt < new Date()) throw expired();

  const user = await prisma.user.findUnique({ where: { id: decoded.sub }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive || user.role !== Role.PATIENT) throw expired();

  // تدوير: إبطال القديم وإصدار جديد (نفس سلوك /api/auth/refresh).
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const tokens = await issueTokens(user.id, user.role);
  const me = await getPatientMe(user.id);
  return { user: me, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

export async function logoutPatient(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(refreshToken) }, data: { revoked: true } });
}

export async function getPatientMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PATIENT_ME_SELECT });
  if (!user || user.role !== Role.PATIENT || !user.patient) throw ApiError.notFound("الحساب غير موجود.");
  // المريض يرى فقط أنه محظور (لتظهر له رسالة واضحة عند الحجز) — لا السبب ولا من حظره.
  const isBlocked = await isPatientBlocked(user.patient.id);
  return { ...user, isBlocked };
}

async function requirePatientId(userId: string): Promise<string> {
  const patient = await prisma.patient.findUnique({ where: { userId }, select: { id: true } });
  if (!patient) throw ApiError.notFound("لم يتم العثور على ملف مريض مرتبط بهذا الحساب.");
  return patient.id;
}

/**
 * مواعيد المريض الحالي فقط (patientId من الجلسة، لا من الطلب). اختيار حقول الطبيب صريح (select)
 * حتى لا يصل للمريض أي حقل داخلي للطبيب (رسوم الاشتراك، userId، حالة التوثيق...).
 */
export async function listMyAppointments(userId: string) {
  const patientId = await requirePatientId(userId);
  return prisma.appointment.findMany({
    where: { patientId },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      type: true,
      createdAt: true,
      doctor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          address: true,
          specialty: { select: { nameAr: true } },
          clinic: { select: { nameAr: true, address: true, phone: true } },
        },
      },
    },
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
    take: 200,
  });
}

/** يعيد معرّف ملف المريض إن كان صاحب التوكن مريضًا فعلًا — يُستعمل لربط الحجز بالحساب. */
export async function findPatientIdForUser(userId: string): Promise<string | null> {
  const patient = await prisma.patient.findUnique({ where: { userId }, select: { id: true } });
  return patient?.id ?? null;
}

/**
 * حفظ اشتراك Push لهذا الجهاز وربطه بالمريض الحالي. userId يأتي من الجلسة دائمًا، ولا يُقبل من الجسم،
 * فلا يمكن لمريض حفظ اشتراك باسم حساب آخر. upsert بالـendpoint (فريد): إن سجّل مستخدم آخر الدخول
 * على نفس المتصفح يُنقل الاشتراك إليه — المتصفح نفسه صار له، فلا تصل تذكيرات الأول لجهاز لم يعد يستعمله.
 */
export async function savePushSubscription(userId: string, sub: PushSubscriptionInput, userAgent: string | null) {
  await requirePatientId(userId);
  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    select: { id: true },
  });
  const devices = await prisma.pushSubscription.count({ where: { userId } });
  return { id: saved.id, devices };
}

/** حذف اشتراك جهاز — فقط إن كان يخص المريض الحالي (deleteMany مشروط بـuserId). */
export async function removePushSubscription(userId: string, endpoint: string) {
  const result = await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
  return { removed: result.count };
}

export async function countMyDevices(userId: string) {
  return prisma.pushSubscription.count({ where: { userId } });
}

/** إشعار تجريبي إلى أجهزة المريض الحالي وحده (لا يمكن توجيهه لأي حساب آخر). */
export async function sendTestPush(userId: string) {
  if (!isPushEnabled()) throw ApiError.unavailable("الإشعارات غير مفعّلة على الخادم بعد.");
  const devices = await countMyDevices(userId);
  if (devices === 0) throw ApiError.badRequest("لم تُفعَّل الإشعارات على أي جهاز بعد.");
  const result = await sendPushToUser(userId, {
    title: "🔔 مادبوك",
    body: "الإشعارات تعمل. سنذكّرك بموعدك قبل ساعة وقبل 5 دقائق.",
    url: "/account",
    tag: "medbook-test",
  });
  return { devices, sent: result.sent, removed: result.removed };
}

export const UPCOMING_STATUSES: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];
