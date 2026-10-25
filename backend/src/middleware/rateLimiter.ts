import rateLimit from "express-rate-limit";
import { createHash } from "crypto";
import { env } from "../config/env";

export const apiLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "عدد كبير من الطلبات. الرجاء المحاولة لاحقًا." },
});

// Stricter limiter for auth endpoints to slow down brute-force attempts
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "محاولات كثيرة لتسجيل الدخول. الرجاء المحاولة بعد قليل." },
});

// تسجيل الدخول (واجهتا الأطباء والمرضى) — حدّان مستقلان عن authLimiter:
// 1) لكل عنوان IP: تُحسب المحاولات الفاشلة فقط، فلا يستنفد مستخدمون كثيرون خلف عنوان مشترك
//    (CGNAT لدى شبكات الهاتف) الحدّ بمجرد تسجيل دخولهم الناجح.
// 2) لكل حساب (بصمة البريد بعد التطبيع): يوقف تخمين كلمة مرور حساب واحد من عناوين كثيرة.
//    الثمن المعروف: من يعرف بريدًا يستطيع تعطيل دخوله مؤقتًا (15 دقيقة) بمحاولات خاطئة.
// العدّادات في ذاكرة النسخة الحالية وتبدأ من الصفر عند إعادة تشغيل Render.
export const LOGIN_IP_FAILURE_LIMIT = 30;
export const LOGIN_ACCOUNT_FAILURE_LIMIT = 10;

export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: LOGIN_IP_FAILURE_LIMIT,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `login-ip:${req.ip}`,
  message: { success: false, message: "محاولات دخول خاطئة كثيرة من هذه الشبكة. الرجاء المحاولة بعد قليل." },
});

export function loginAccountKey(email: unknown): string {
  if (typeof email !== "string" || email.length > 254) return "login-account:invalid";
  return "login-account:" + createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: LOGIN_ACCOUNT_FAILURE_LIMIT,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => loginAccountKey((req.body as { email?: unknown } | undefined)?.email),
  message: { success: false, message: "محاولات دخول خاطئة كثيرة لهذا الحساب. انتظر 15 دقيقة ثم أعد المحاولة." },
});

// تغيير رقم الهاتف من الملف الشخصي: الرقم فريد، فرد «مستخدم مسبقًا» يكشف أن الرقم مسجّل.
// حدّ لكل حساب يجعل هذا المسار أداة بطيئة غير صالحة لفحص أرقام كثيرة.
export const PHONE_CHANGE_LIMIT = 5;
export const phoneChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: PHONE_CHANGE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `phone-change:${req.user!.id}`,
  skip: req => typeof (req.body as { phone?: unknown } | undefined)?.phone !== "string" || (req.body as { phone: string }).phone === "",
  message: { success: false, message: "محاولات كثيرة لتغيير رقم الهاتف. الرجاء المحاولة لاحقًا." },
});

// مسارات حجز الضيف (lookup/cancel) لا تتطلب حسابًا: رقم الهاتف وحده هو "المفتاح"، لذا نحدّها
// بنفس صرامة تسجيل الدخول حتى لا يستطيع أحد تجربة أرقام هواتف جزائرية عشوائية بسرعة كبيرة
// لاكتشاف مواعيد مرضى آخرين (لا يمنع المحاولات المتفرقة، لكنه يمنع التخمين الآلي السريع).
export const bookingLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "محاولات كثيرة. الرجاء المحاولة بعد قليل." },
});

// Share one budget across both patient booking APIs. Identity comes only from
// authenticate, so changing IP, beneficiary, doctor or route cannot reset it.
export const PATIENT_BOOKING_ATTEMPT_LIMIT = 20;
export const patientBookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: PATIENT_BOOKING_ATTEMPT_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `patient-booking:${req.user!.id}`,
  message: { success: false, message: "محاولات حجز كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة." },
});

// Public discovery can fan out into many DB queries. Leave tracking and staff
// polling outside this burst limit; retain the existing general IP budget.
export const PUBLIC_DISCOVERY_LIMIT = 120;
export const publicDiscoveryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: PUBLIC_DISCOVERY_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "طلبات بحث كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة." },
});

// متابعة الدور (/booking/status/:id) عامة لأن الرابط يُفتح من الإشعارات ومن أجهزة بلا جلسة.
// المريض يستطلع كل 20 ث (≈ 15 طلبًا كل 5 دقائق)، والحد واسع ليتشارك مرضى قاعة انتظار واحدة
// شبكة العيادة نفسها، لكنه يمنع استعمال المسار المكلف (عدة استعلامات لكل طلب) لاستنزاف الخادم.
export const BOOKING_STATUS_LIMIT = 300;
export const bookingStatusLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: BOOKING_STATUS_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة." },
});
