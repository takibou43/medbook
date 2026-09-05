import { env } from "../config/env";

function toInternationalPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (/^0[5-7]\d{8}$/.test(digits)) return "213" + digits.slice(1);
  if (/^213[5-7]\d{8}$/.test(digits)) return digits;
  return null;
}

export interface SendSmsResult {
  success: boolean;
  error?: string;
}

export async function sendSms(phone: string, message: string): Promise<SendSmsResult> {
  const to = toInternationalPhone(phone);
  if (!to) {
    const error = `رقم هاتف غير صالح: ${phone}`;
    console.error(`[SMS] ${error}`);
    return { success: false, error };
  }

  const { budgetsmsUsername, budgetsmsUserId, budgetsmsHandle, senderId } = env.sms;
  if (!budgetsmsUsername || !budgetsmsUserId || !budgetsmsHandle) {
    const error = "مزوّد SMS غير مُعدّ بعد (متغيرات BudgetSMS فارغة في البيئة).";
    console.log(`[SMS معطّل — لم يُضبط مزوّد بعد] كان سيُرسل إلى ${to}: ${message}`);
    return { success: false, error };
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
    const res = await fetch(`https://api.budgetsms.net/sendsms/?${params.toString()}`);
    const text = (await res.text()).trim();
    if (!/^OK/i.test(text)) {
      console.error(`[SMS] فشل الإرسال إلى ${to}: ${text}`);
      return { success: false, error: text };
    }
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "خطأ غير معروف أثناء الاتصال بمزوّد الرسائل.";
    console.error("[SMS] خطأ أثناء الاتصال بمزوّد الرسائل:", err);
    return { success: false, error };
  }
}
