import { Role, VerificationStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "../utils/ApiError";

/**
 * حساب واحد بملفين (مريض + طبيب).
 *
 * التصميم: User.role يبقى دور الحساب «الأصلي» كما أُنشئ ولا يُستبدل أبدًا (طبيب يبقى DOCTOR،
 * ومريض يبقى PATIENT). الملفّان نفساهما هما جدولا Patient وDoctor الموجودان أصلًا، وكلاهما
 * فريد على userId، فلا يمكن تكرار ملف لنفس الحساب حتى مع الطلبات المتزامنة.
 *
 * «سياق الجلسة» (الدور داخل JWT) هو الواجهة التي دخل منها المستخدم: PATIENT أو DOCTOR.
 * الخادم لا يثق بالمطالبة وحدها: في كل طلب يتحقق middleware/auth أن الحساب يحمل فعلًا الملف الذي
 * يقتضيه السياق، وكل مسار يبقى مقيّدًا بـauthorize(Role.X) على السياق. لذلك لا يمنح تفعيل ملف المريض
 * صلاحيات الطبيب، ولا يمنح طلب الطبيب (PENDING) إلا ما يملكه أي طبيب قيد المراجعة اليوم.
 */

/** الأدوار التي يجوز لها حمل الملفين. المساعد والإدارة ومالك العيادة غير معنيين. */
export function canHoldBothProfiles(role: Role): boolean {
  return role === Role.PATIENT || role === Role.DOCTOR;
}

/** هل يحمل الحساب الملف الذي يقتضيه السياق المطلوب؟ (استعلام إضافي لا يُنفَّذ إلا عند اختلاف السياق عن الدور الأصلي.) */
export async function holdsContext(userId: string, dbRole: Role, wanted: Role): Promise<boolean> {
  if (wanted === dbRole) return true;
  if (!canHoldBothProfiles(dbRole)) return false;
  if (wanted === Role.PATIENT && dbRole === Role.DOCTOR) {
    return !!(await prisma.patient.findUnique({ where: { userId }, select: { id: true } }));
  }
  if (wanted === Role.DOCTOR && dbRole === Role.PATIENT) {
    return !!(await prisma.doctor.findUnique({ where: { userId }, select: { id: true } }));
  }
  return false;
}

/** سياق واجهة الأطباء لهذا الحساب: مريض يملك ملف طبيب (قيد المراجعة أو معتمد) يدخل كطبيب؛ غير ذلك دوره الأصلي. */
export function doctorPortalRole(user: { role: Role; doctor?: { id: string } | null }): Role {
  return user.role === Role.PATIENT && user.doctor ? Role.DOCTOR : user.role;
}

/** سياق واجهة المرضى: يملك ملف مريض ودوره الأصلي PATIENT أو DOCTOR؛ وإلا null (لا يدخل واجهة المرضى). */
export function patientPortalRole(user: { role: Role; patient?: { id: string } | null }): Role | null {
  if (user.role === Role.PATIENT) return Role.PATIENT;
  if (user.role === Role.DOCTOR && user.patient) return Role.PATIENT;
  return null;
}

/** حساب طبيب (دوره الأصلي DOCTOR، أو مريض قدّم ملف طبيب). تُستعمل حيث كان الكود يفحص User.role === DOCTOR. */
export function isDoctorAccount(user: { role: Role; doctor?: { id: string } | null }): boolean {
  return user.role === Role.DOCTOR || (user.role === Role.PATIENT && !!user.doctor);
}

export interface AccountProfiles {
  patient: boolean;
  doctor: { status: VerificationStatus } | null;
  /** طبيب بلا ملف مريض: يستطيع تفعيله. */
  canAddPatientProfile: boolean;
  /** مريض بلا ملف طبيب: يستطيع تقديم الطلب. */
  canApplyAsDoctor: boolean;
}

export function summarizeProfiles(user: {
  role: Role;
  patient?: { id: string } | null;
  doctor?: { id: string; verificationStatus: VerificationStatus } | null;
}): AccountProfiles {
  const patient = !!user.patient;
  const doctor = user.doctor ? { status: user.doctor.verificationStatus } : null;
  return {
    patient,
    doctor,
    canAddPatientProfile: user.role === Role.DOCTOR && !patient,
    canApplyAsDoctor: user.role === Role.PATIENT && !doctor,
  };
}

export const PROFILE_PROBE = {
  patient: { select: { id: true } },
  doctor: { select: { id: true, verificationStatus: true } },
} as const;

/** تحميل ملخص الملفين من قاعدة البيانات. */
export async function loadProfiles(userId: string): Promise<AccountProfiles | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, ...PROFILE_PROBE } });
  return user ? summarizeProfiles(user) : null;
}

// رسالة موحّدة عند التسجيل ببريد/هاتف موجود: توجّه إلى تسجيل الدخول ثم إضافة الملف المطلوب من داخل الحساب.
// لا نربط الحساب الموجود ولا نغيّر كلمة مروره بمجرد معرفة بريده أو هاتفه، ولا نكشف أي ملفات يحملها.
export const ACCOUNT_EXISTS_MESSAGE =
  "هذا البريد الإلكتروني أو رقم الهاتف مسجّل بالفعل. سجّل الدخول إلى حسابك ثم أضف الملف المطلوب (مريض أو طبيب) من داخل الحساب.";
export const accountExistsError = () => ApiError.conflict(ACCOUNT_EXISTS_MESSAGE, { code: "ACCOUNT_EXISTS" });

export const SELF_BOOKING_MESSAGE = "لا يمكنك حجز موعد لدى ملفك المهني كطبيب. اختر طبيبًا آخر.";

/** حساب بملفين لا يحجز عند نفسه: يُرفض الحجز إن كان الطبيب المختار هو ملف الحساب نفسه (يُفحص من الجلسة لا من الطلب). */
export async function assertNotOwnDoctor(userId: string, doctorId: string | null | undefined) {
  if (!doctorId) return;
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { userId: true } });
  if (doctor && doctor.userId === userId) throw ApiError.forbidden(SELF_BOOKING_MESSAGE);
}
