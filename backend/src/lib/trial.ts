import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "../config/env";

/**
 * إدارة فترة التجربة المجانية للأطباء مركزيًا.
 *
 * لماذا هنا وليس عند التسجيل؟ لأن المعالجة المركزية تغطّي أيضًا الأطباء المسجّلين مسبقًا
 * ومن يُضافون بأي طريقة أخرى، ولا تتطلب لمس منطق التسجيل والمصادقة أصلًا.
 */

/** نهاية التجربة (آخر لحظة من اليوم المحدد)، أو null إن أُوقفت التجربة من متغيرات البيئة. */
export function trialEndsAt(): Date | null {
  const raw = (env.trial.endsAt || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw + "T23:59:59Z");
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function isTrialRunning(now: Date = new Date()): boolean {
  const end = trialEndsAt();
  return Boolean(end && now < end);
}

/**
 * تزامن حالات الاشتراك مع فترة التجربة. يُنفّذ عند الإقلاع ثم دوريًا:
 *
 * 1) ما دامت التجربة سارية: كل طبيب لم يسبق منحه اشتراكًا قط (subscriptionExpiresAt فارغ)
 *    يُفعّل تلقائيًا حتى تاريخ نهاية التجربة. وضعنا شرط "لم يُمنح قط" عمدًا حتى يبقى
 *    إيقافك اليدوي لأي طبيب (من لوحة الإدارة) نافذًا ولا تُعيد هذه المهمة تفعيله بعد دقائق.
 * 2) في كل الأحوال: من انتهت صلاحية اشتراكه ينتقل إلى EXPIRED فيختفي من موقع المرضى
 *    ويتوقف الحجز معه — دون حذف أي بيانات، فيكفي تغيير الحالة ليعود كما كان.
 *
 * لا ترمي استثناءً أبدًا: فشلها يجب ألا يمنع الخادم من الإقلاع أو يعطّل أي طلب.
 */
export async function syncTrialSubscriptions(): Promise<{ activated: number; expired: number }> {
  const now = new Date();
  const end = trialEndsAt();
  let activated = 0;
  let expired = 0;

  try {
    if (end && now < end) {
      const granted = await prisma.doctor.updateMany({
        where: { subscriptionStatus: SubscriptionStatus.UNPAID, subscriptionExpiresAt: null },
        data: { subscriptionStatus: SubscriptionStatus.ACTIVE, subscriptionExpiresAt: end },
      });
      activated = granted.count;
      if (activated > 0) {
        console.log("✅ مُنحت التجربة المجانية لـ " + activated + " طبيبًا حتى " + end.toISOString().slice(0, 10));
      }
    }

    const lapsed = await prisma.doctor.updateMany({
      where: { subscriptionStatus: SubscriptionStatus.ACTIVE, subscriptionExpiresAt: { lt: now } },
      data: { subscriptionStatus: SubscriptionStatus.EXPIRED },
    });
    expired = lapsed.count;
    if (expired > 0) {
      console.log("⏹️ انتهت صلاحية اشتراك " + expired + " طبيبًا.");
    }
  } catch (err) {
    console.error("تعذّرت مزامنة فترة التجربة:", err);
  }

  return { activated, expired };
}
