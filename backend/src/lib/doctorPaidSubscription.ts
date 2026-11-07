import { SubscriptionStatus } from "@prisma/client";
import { ApiError } from "../utils/ApiError";

export type DoctorSubscriptionEdit = {
  subscriptionStatus?: SubscriptionStatus;
  subscriptionExpiresAt?: Date | null;
  subscriptionMonths?: number;
  expectedSubscriptionExpiresAt?: Date | null;
};

export function paidSubscriptionData(
  before: { subscriptionStatus: SubscriptionStatus; subscriptionExpiresAt: Date | null },
  input: DoctorSubscriptionEdit,
  now = new Date(),
) {
  const { subscriptionMonths, expectedSubscriptionExpiresAt, ...data } = input;
  const renewal = subscriptionMonths !== undefined;
  if (renewal) {
    if (!Number.isInteger(subscriptionMonths) || subscriptionMonths < 1 || subscriptionMonths > 120) {
      throw ApiError.badRequest("عدد الأشهر يجب أن يكون بين 1 و120.");
    }
    if (data.subscriptionStatus !== SubscriptionStatus.ACTIVE ||
        expectedSubscriptionExpiresAt === undefined || data.subscriptionExpiresAt !== undefined) {
      throw ApiError.badRequest("طلب تجديد الاشتراك غير صالح.");
    }
    if ((before.subscriptionExpiresAt?.getTime() ?? null) !== (expectedSubscriptionExpiresAt?.getTime() ?? null)) {
      throw ApiError.conflict("تغير الاشتراك. حدّث الصفحة قبل إعادة المحاولة.");
    }
  }
  if (data.subscriptionStatus !== SubscriptionStatus.ACTIVE) return data;
  // An explicit renewal adds the paid months without losing any remaining paid/trial time.
  // Older activation clients also recover expired or undated subscriptions.
  const expiresAt = data.subscriptionExpiresAt;
  if (expiresAt !== undefined && (!expiresAt || expiresAt <= now)) {
    throw ApiError.badRequest("يجب تحديد تاريخ انتهاء مستقبلي للاشتراك المفعّل.");
  }
  const shouldExtend = renewal || (!expiresAt &&
    (!before.subscriptionExpiresAt || before.subscriptionExpiresAt <= now));
  return {
    ...data,
    ...(shouldExtend ? {
      subscriptionExpiresAt: new Date(Math.max(now.getTime(), before.subscriptionExpiresAt?.getTime() ?? 0) + (subscriptionMonths ?? 1) * 30 * 86400000),
    } : {}),
    // Paid activation consumes free-trial eligibility, including before first approval.
    newDoctorTrial: false,
  };
}
