// إشعار "لم يحضر" يُرسل من شريحة هاتف الطبيب نفسه عبر رابط sms: — بلا مزوّد SMS
// خارجي ولا مفتاح API في الواجهة. كل ما هنا يعمل في المتصفح فقط.

/**
 * توحيد رقم الهاتف الجزائري إلى الصيغة الدولية +213XXXXXXXXX.
 * يقبل: 0555123456 / 0555 12 34 56 / 0555-12-34-56 / 00213555123456 /
 *        213555123456 / +213555123456 / 555123456
 * يُرجع null لكل ما ليس رقم محمول جزائري صالح (فارغ، طول خاطئ، هاتف ثابت...).
 */
export function normalizeAlgerianPhone(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00213")) digits = digits.slice(5);
  else if (digits.startsWith("213")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  // المحمول الجزائري: 9 أرقام تبدأ بـ 5 (جازي) أو 6 (أوريدو) أو 7 (موبيليس).
  if (!/^[5-7]\d{8}$/.test(digits)) return null;
  return "+213" + digits;
}

/** يُفرغ أي قيمة غير مفيدة (null/undefined/"undefined") إلى نص فارغ. */
function clean(value?: string | null): string {
  const s = (value ?? "").toString().trim();
  return s && s !== "undefined" && s !== "null" ? s : "";
}

/** تاريخ ثابت الشكل يوم/شهر/سنة — لا يتأثر بلغة الهاتف ولا بالمنطقة الزمنية (التاريخ مخزَّن 00:00 UTC). */
export function formatDateForSms(value?: string | null): string {
  const s = clean(value);
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * نص الإشعار مبنيًّا من بيانات الموعد فقط. أي بيانة ناقصة تُحذف من الجملة كاملة
 * بدل ظهور undefined أو فراغ.
 */
export function buildNoShowMessage(parts: {
  doctorName?: string | null;
  patientName?: string | null;
  date?: string | null;
  time?: string | null;
}): string {
  const doctorName = clean(parts.doctorName);
  const patientName = clean(parts.patientName);
  const date = formatDateForSms(parts.date);
  const time = clean(parts.time);

  const when: string[] = [];
  if (date) when.push(`بتاريخ ${date}`);
  if (time) when.push(`على الساعة ${time}`);

  return [
    doctorName ? `مادبوك - د. ${doctorName}` : "مادبوك",
    "",
    patientName ? `عزيزي/عزيزتي ${patientName}،` : "عزيزي/عزيزتي المريض،",
    `لقد حان موعدكم${doctorName ? ` مع الدكتور ${doctorName}` : ""}${when.length ? " " + when.join(" ") : ""}، ولم يتم تسجيل حضوركم.`,
    "",
    "إذا كنتم ترغبون في حجز موعد جديد، يرجى التواصل مع العيادة.",
    "",
    "شكراً لتفهمكم.",
  ].join("\n");
}

/** iPadOS 13+ يُعرّف نفسه كـ Macintosh، فنكشفه بوجود اللمس. */
function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

/** هل نحن على هاتف/لوحي فيه تطبيق رسائل؟ على الحاسوب نعرض بديل النسخ. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent || "") || isIos();
}

/** iOS يفصل نص الرسالة بـ "&" وأندرويد/بقية المتصفحات بـ "?". النص مُرمَّز دائمًا. */
export function buildSmsHref(phoneE164: string, message: string): string {
  return `sms:${phoneE164}${isIos() ? "&" : "?"}body=${encodeURIComponent(message)}`;
}

/** نسخ يعمل أيضًا حيث لا يتوفر navigator.clipboard (اتصال غير آمن أو متصفح قديم). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // نُكمل إلى الطريقة البديلة أدناه
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
