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
