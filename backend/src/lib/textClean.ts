import { z } from "zod";

/**
 * تنظيف النصوص القصيرة التي يكتبها المستخدم (أسماء أفراد العائلة، عناوين خطط العلاج...):
 * حذف محارف التحكم وعلامات الاتجاه غير المرئية (التي تُستعمل لتشويه العرض في واجهة RTL)،
 * وتوحيد المسافات. لا يغيّر الحروف العربية/اللاتينية نفسها.
 */
export function cleanText(input: string): string {
  return input
    // محارف التحكم C0/C1 (ما عدا المسافة) + محارف الاتجاه/العرض الصفري غير المرئية.
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** نفس cleanText لكنه يحافظ على الأسطر (للملاحظات والأوصاف متعددة الأسطر). */
export function cleanMultiline(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** مخطط Zod لنص قصير نظيف بطول محدد (بعد التنظيف). */
export function cleanString(min: number, max: number, tooShort = "النص قصير جدًا", tooLong = "النص طويل جدًا") {
  return z.string().transform(cleanText).pipe(z.string().min(min, tooShort).max(max, tooLong));
}

/** مخطط Zod لنص طويل اختياري (قد يُرسل null لمسحه)؛ الفارغ بعد التنظيف يصبح null. */
export function cleanOptionalMultiline(max: number, tooLong = "النص طويل جدًا") {
  return z
    .string()
    .transform(cleanMultiline)
    .pipe(z.string().max(max, tooLong))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
}
