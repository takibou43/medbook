import rateLimit from "express-rate-limit";
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
