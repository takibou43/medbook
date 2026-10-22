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

// حدّ محاولات الدخول الفاشلة لكل بريد إلكتروني (إضافة إلى authLimiter الذي يعدّ لكل IP): هجوم موزَّع على
// عناوين كثيرة كان يستطيع تخمين كلمة مرور حساب واحد بلا سقف. تُحسب المحاولات الفاشلة فقط
// (skipSuccessfulRequests) فلا يتأثر المستخدم الشرعي بنجاح دخوله، ويُصفَّر العدّاد بعد نافذة 15 دقيقة.
// الحساب الحقيقي قد يُقفل مؤقتًا عن المهاجم وعن صاحبه معًا، وهو ثمن مقبول مقابل حماية حساب طبيب يحمل بيانات مرضى.
export const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "";
    return email ? `login-email:${email}` : `login-ip:${req.ip ?? "unknown"}`;
  },
  message: { success: false, message: "محاولات دخول فاشلة كثيرة لهذا الحساب. الرجاء المحاولة بعد 15 دقيقة." },
});
