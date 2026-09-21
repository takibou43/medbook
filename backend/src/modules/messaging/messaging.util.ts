import { ApiError } from "../../utils/ApiError";

export const MAX_MESSAGE_LENGTH = 2000;

/**
 * يُنظّف نص الرسالة ويتحقق منه على الخادم (الواجهة لا يُوثق بها):
 * - يزيل محارف التحكم (عدا سطر جديد/Tab) التي قد تُستعمل لإخفاء نص أو كسر العرض.
 * - يطبّع الأسطر ويقلّص الأسطر الفارغة المتتالية.
 * - يرفض الرسالة الفارغة أو التي تتجاوز الحد.
 * لا نُحوّل المحارف الخاصة بـHTML هنا: التخزين نصّ خام، والعرض في React يهرّب النص تلقائيًا
 * (لا dangerouslySetInnerHTML)، وترميز HTML عند التخزين يفسد النص عند العرض.
 */
export function sanitizeMessageContent(raw: unknown): string {
  if (typeof raw !== "string") throw ApiError.badRequest("نص الرسالة مطلوب.");
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length === 0) throw ApiError.badRequest("لا يمكن إرسال رسالة فارغة.");
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    throw ApiError.badRequest(`الرسالة طويلة جدًا (الحد الأقصى ${MAX_MESSAGE_LENGTH} حرف).`);
  }
  return cleaned;
}

export function previewOf(content: string, max = 80): string {
  const one = content.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}
