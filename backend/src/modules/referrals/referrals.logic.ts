import { randomInt } from "crypto";

/**
 * منطق الإحالة النقي (بلا قاعدة بيانات) — يُختبر مباشرة.
 */

export const REFERRAL_REWARD_DAYS = 30;
const DAY_MS = 86_400_000;

// أبجدية بلا محارف ملتبسة (0/O، 1/I/L) — تُقرأ وتُكتب بسهولة من الهاتف.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8; // 31^8 ≈ 8.5×10^11 احتمال — غير قابل للتخمين بسهولة مع حدّ المعدل على مسار التحقق.

/** كود إحالة عشوائي آمن تشفيريًا، بصيغة MB-XXXXXXXX. */
export function generateReferralCode(rand: (max: number) => number = randomInt): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[rand(ALPHABET.length)];
  return `MB-${out}`;
}

/** تطبيع ما يكتبه الطبيب: مسافات، أحرف صغيرة، وبادئة MB- اختيارية. يعيد null للصيغة غير الصالحة. */
export function normalizeReferralCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().toUpperCase().replace(/\s+/g, "");
  // جسم الكود نفسه قد يبدأ بـ"MB" (مثل MBCDEFGH)، فلا نحذف البادئة إلا إن كان الطول يتجاوز جسم الكود.
  const s = raw.length === CODE_LENGTH ? raw : raw.replace(/^MB-?/, "");
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return `MB-${s}`;
}

/**
 * تاريخ انتهاء اشتراك المُحيل بعد إضافة المكافأة:
 *  - اشتراك فعّال (ACTIVE وتاريخه في المستقبل): الإضافة تبدأ من max(subscriptionExpiresAt, now).
 *  - منتهٍ أو غير مدفوع: تبدأ من الآن.
 *  - في الحالتين، إن كانت التجربة المجانية العامة سارية تبدأ الإضافة من نهايتها على الأقل،
 *    حتى لا تضيع الأيام الثلاثون داخل فترة مجانية أصلًا.
 */
export function computeReferralExtension(
  sub: { subscriptionStatus: "UNPAID" | "ACTIVE" | "EXPIRED"; subscriptionExpiresAt: Date | null },
  now: Date,
  trialEndsAt: Date | null,
  rewardDays: number = REFERRAL_REWARD_DAYS
): Date {
  let baseMs = now.getTime();
  if (sub.subscriptionStatus === "ACTIVE" && sub.subscriptionExpiresAt && sub.subscriptionExpiresAt.getTime() > baseMs) {
    baseMs = sub.subscriptionExpiresAt.getTime();
  }
  if (trialEndsAt && trialEndsAt.getTime() > now.getTime() && trialEndsAt.getTime() > baseMs) {
    baseMs = trialEndsAt.getTime();
  }
  return new Date(baseMs + rewardDays * DAY_MS);
}

/** حالات الإحالة التي ما زالت تستحق المكافأة عند التوثيق الفعلي للطبيب المُحال. */
export const REWARDABLE_STATUSES = ["PENDING", "QUALIFIED", "REJECTED"] as const;
