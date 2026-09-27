import { env } from "../config/env";

/**
 * إرسال SMS عبر BudgetSMS.
 *
 * الخصوصية في السجلات: لا نسجّل أبدًا رقم الهاتف كاملًا ولا نص الرسالة ولا رد المزوّد الخام ولا رابط الطلب
 * (يحمل بيانات اعتماد المزوّد في query string — قيد من المزوّد نفسه). السجل يحمل رقمًا مُخفى ورمز نتيجة فقط.
 * المهلة: كل طلب للمزوّد محدود بـ SMS_TIMEOUT_MS عبر AbortSignal.timeout المدمج (بلا حزم إضافية).
 */

export const SMS_TIMEOUT_MS = 10_000;

export type SmsResultCode = "SENT" | "INVALID_PHONE" | "NOT_CONFIGURED" | "PROVIDER_REJECTED" | "TIMEOUT" | "NETWORK_ERROR";

export interface SendSmsResult {
  success: boolean;
  /** رمز ثابت قابل للتشخيص والفرز — بلا أي بيانات شخصية. */
  code: SmsResultCode;
  /** رسالة عربية آمنة للحفظ في SmsLog.failureReason — لا هاتف ولا نص رسالة ولا رد خام. */
  error?: string;
}

function toInternationalPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (/^0[5-7]\d{8}$/.test(digits)) return "213" + digits.slice(1);
  if (/^213[5-7]\d{8}$/.test(digits)) return digits;
  return null;
}

/** يُخفي الرقم للسجلات: 213551234567 → 2135******67. */
export function maskPhoneForLog(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length <= 6) return "*".repeat(digits.length);
  return digits.slice(0, 4) + "*".repeat(digits.length - 6) + digits.slice(-2);
}

/** من رد BudgetSMS نأخذ رمز الخطأ الرقمي فقط (مثل "ERR 1001") — لا نص حر قد يعكس بيانات الطلب. */
function providerErrorCode(body: string): string {
  const m = /^ERR\s*(\d{1,6})/i.exec(body.trim());
  return m ? `ERR ${m[1]}` : "UNKNOWN";
}

function log(level: "log" | "warn" | "error", code: SmsResultCode, to: string, extra?: string) {
  console[level](`[SMS] ${code} to=${maskPhoneForLog(to)}${extra ? ` ${extra}` : ""}`);
}

export async function sendSms(phone: string, message: string, timeoutMs: number = SMS_TIMEOUT_MS): Promise<SendSmsResult> {
  const to = toInternationalPhone(phone ?? "");
  if (!to) {
    log("error", "INVALID_PHONE", phone ?? "");
    return { success: false, code: "INVALID_PHONE", error: "رقم هاتف غير صالح." };
  }

  const { budgetsmsUsername, budgetsmsUserId, budgetsmsHandle, senderId } = env.sms;
  if (!budgetsmsUsername || !budgetsmsUserId || !budgetsmsHandle) {
    log("log", "NOT_CONFIGURED", to, `len=${message.length}`);
    return { success: false, code: "NOT_CONFIGURED", error: "مزوّد SMS غير مُعدّ بعد (متغيرات BudgetSMS فارغة في البيئة)." };
  }

  const params = new URLSearchParams({
    username: budgetsmsUsername,
    userid: budgetsmsUserId,
    handle: budgetsmsHandle,
    msg: message,
    from: senderId,
    to,
  });

  try {
    const res = await fetch(`https://api.budgetsms.net/sendsms/?${params.toString()}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = (await res.text()).trim();
    if (!/^OK/i.test(text)) {
      const providerCode = providerErrorCode(text);
      log("error", "PROVIDER_REJECTED", to, `provider=${providerCode} http=${res.status}`);
      return { success: false, code: "PROVIDER_REJECTED", error: `رفض مزوّد الرسائل الطلب (${providerCode}).` };
    }
    log("log", "SENT", to);
    return { success: true, code: "SENT" };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      log("error", "TIMEOUT", to, `after=${timeoutMs}ms`);
      return { success: false, code: "TIMEOUT", error: "انتهت مهلة الاتصال بمزوّد الرسائل." };
    }
    // اسم الخطأ فقط — رسالة الخطأ/السبب قد تحتوي رابط الطلب ببيانات الاعتماد.
    log("error", "NETWORK_ERROR", to, `err=${name || "unknown"}`);
    return { success: false, code: "NETWORK_ERROR", error: "تعذّر الاتصال بمزوّد الرسائل." };
  }
}
