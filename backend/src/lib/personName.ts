import { z } from "zod";

/**
 * اسم/لقب شخص: أحرف أبجدية (عربية/لاتينية/مشكّلة) + مسافة وشرطة ونقطة وفاصلة عليا فقط.
 * يمنع < > " & والأرقام والرموز، فلا يستطيع أحد تخزين HTML/JS في اسمه (دفاع بالعمق ضد XSS
 * في أي مكان يُعرض فيه الاسم خارج React، كنوافذ الطباعة).
 */
export const PERSON_NAME_REGEX = /^[\p{L}\p{M}][\p{L}\p{M}\s'’\-.]*$/u;

export const personName = (minMsg = "النص قصير جدًا", max = 60) =>
  z
    .string()
    .trim()
    .min(2, minMsg)
    .max(max, `النص طويل جدًا (${max} حرفًا كحد أقصى)`)
    .regex(PERSON_NAME_REGEX, "الاسم يحتوي محارف غير مسموحة");
