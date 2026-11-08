import { SubscriptionStatus } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { renewalQuote, MONTHLY_PRICE_DZD, MAX_PAYMENT_DZD, type BillingSchedule } from './subscriptionCalendar';

export type DoctorSubscriptionEdit = {
  subscriptionStatus?: SubscriptionStatus;
  subscriptionExpiresAt?: Date | null;
  subscriptionMonths?: number;
  subscriptionAmountDzd?: number;
  expectedSubscriptionExpiresAt?: Date | null;
};

export function paidSubscriptionChange(
  before: { subscriptionStatus: SubscriptionStatus; subscriptionExpiresAt: Date | null },
  input: DoctorSubscriptionEdit,
  now = new Date(),
  schedule?: BillingSchedule | null,
) {
  const { subscriptionMonths, subscriptionAmountDzd, expectedSubscriptionExpiresAt, ...data } = input;
  const renewal = subscriptionMonths !== undefined || subscriptionAmountDzd !== undefined;
  if (renewal) {
    if (subscriptionMonths !== undefined && (!Number.isInteger(subscriptionMonths) || subscriptionMonths < 1 || subscriptionMonths > 120)) {
      throw ApiError.badRequest('عدد الأشهر يجب أن يكون بين 1 و120.');
    }
    if (subscriptionAmountDzd !== undefined && (!Number.isSafeInteger(subscriptionAmountDzd) || subscriptionAmountDzd < 1 || subscriptionAmountDzd > MAX_PAYMENT_DZD)) {
      throw ApiError.badRequest('أدخل مبلغًا صحيحًا من 1 إلى 600000 دج.');
    }
    if ((subscriptionMonths !== undefined && subscriptionAmountDzd !== undefined) || data.subscriptionStatus !== SubscriptionStatus.ACTIVE ||
      expectedSubscriptionExpiresAt === undefined || data.subscriptionExpiresAt !== undefined) {
      throw ApiError.badRequest('طلب تجديد الاشتراك غير صالح.');
    }
    if ((before.subscriptionExpiresAt?.getTime() ?? null) !== (expectedSubscriptionExpiresAt?.getTime() ?? null)) {
      throw ApiError.conflict('تغير الاشتراك. حدّث الصفحة قبل إعادة المحاولة.');
    }
  }
  if (data.subscriptionStatus !== SubscriptionStatus.ACTIVE) return { data, quote: null };
  const expiresAt = data.subscriptionExpiresAt;
  if (expiresAt !== undefined && (!expiresAt || expiresAt <= now)) {
    throw ApiError.badRequest('يجب تحديد تاريخ انتهاء مستقبلي للاشتراك المفعّل.');
  }
  const shouldExtend = renewal || (!expiresAt && (!before.subscriptionExpiresAt || before.subscriptionExpiresAt <= now));
  const quote = shouldExtend ? renewalQuote(subscriptionAmountDzd ?? (subscriptionMonths ?? 1) * MONTHLY_PRICE_DZD,
    before.subscriptionExpiresAt?.getTime() ?? 0, now.getTime(), schedule) : null;
  return { data: { ...data, ...(quote ? {subscriptionExpiresAt: new Date(quote.after)} : {}), newDoctorTrial: false }, quote };
}

export function paidSubscriptionData(...args: Parameters<typeof paidSubscriptionChange>) {
  return paidSubscriptionChange(...args).data;
}
