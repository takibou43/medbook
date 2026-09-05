import { env } from "../config/env";

// يحوّل رقم هاتف جزائري محلي (05/06/07XXXXXXXX) إلى صيغة دولية بدون '+' (213XXXXXXXXX)
// وهي الصيغة التي يتطلبها BudgetSMS في معامل "to".
function toInternationalPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (/^0[5-7]\d{8}$/.test(digits)) return "213" + digits.slice(1);
  if (/^213[5-7]\d{8}$/.test(digits)) return digits;
  return null;
}

/**
 * يرسل رسالة SMS عبر BudgetSMS. إن لم تُضبط بيانات الحساب بعد في متغيرات البيئة
 * (BUDGETSMS_USERNAME / BUDGETSMS_USERID / BUDGETSMS_HANDLE) فلن تُرسل أي رسالة فعليًا —
 * ستُسجَّل فقط في السجلات (وضع تجريبي)، حتى لا يتعطل أي شيء قبل ضبط مزوّد حقيقي.
 * ترجع true فقط عند تأكيد الإرسال من BudgetSMS.
 */
export async function sendSms(phone: string, message: string): Promise<boolean> {
  const to = toInternationalPhone(phone);
  if (!to) {
    console.error(`[SMS] رقم هاتف غير صالح لإرسال التذكير: ${phone}`);
    return false;
  }

  const { budgetsmsUsername, budgetsmsUserId, budgetsmsHandle, senderId } = env.sms;
  if (!budgetsmsUsername || !budgetsmsUserId || !budgetsmsHandle) {
    console.log(`[SMS معطّل — لم يُضبط مزوّد بعد] كان سيُرسل إلى ${to}: ${message}`);
    return false;
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
      return false;
    }
    return true;
  } catch (err) {
    console.error("[SMS] خطأ أثناء الاتصال بمزوّد الرسائل:", err);
    return false;
  }
}
