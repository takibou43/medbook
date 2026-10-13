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

// حجز المواعيد: حدّ لكل مستخدم مسجَّل (وليس لكل IP فقط، فالشبكات المشتركة شائعة) يقطع الحجز الآلي السريع.
// يعمل بعد authenticate فيتوفر req.user؛ وإلا يعود إلى عنوان IP.
const bookingKey = (req: import("express").Request) => req.user?.id ?? req.ip ?? "unknown";

export const bookingCreateBurstLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 6,
  keyGenerator: bookingKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "حجوزات كثيرة خلال وقت قصير. الرجاء المحاولة بعد قليل." },
});

export const bookingCreateDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 20,
  keyGenerator: bookingKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "بلغت الحد اليومي لمحاولات الحجز. الرجاء المحاولة غدًا." },
});
