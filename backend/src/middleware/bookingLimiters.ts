import { Request } from "express";
import rateLimit from "express-rate-limit";

// حجز المواعيد: حدّ لكل مستخدم مسجَّل (وليس لكل IP فقط، فالشبكات المشتركة شائعة) يقطع الحجز الآلي السريع.
// يعمل بعد authenticate فيتوفر req.user؛ وإلا يعود إلى عنوان IP.
// في ملف مستقل عن rateLimiter.ts كي تستطيع الاختبارات القديمة (التي تحجز عشرات المواعيد بحساب واحد)
// محاكاته وحده دون المساس بـapiLimiter؛ لا يوجد أي مفتاح تعطيل في كود الإنتاج.
const bookingKey = (req: Request) => req.user?.id ?? req.ip ?? "unknown";

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
