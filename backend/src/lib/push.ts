import webpush from "web-push";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { FIVE_MINUTE_ALARM_KIND } from "./pushKinds";

// إشعارات المتصفح (Web Push). تعمل فقط إذا ضُبط مفتاحا VAPID في متغيرات البيئة.
// عند غيابهما تُعطّل الميزة بهدوء: لا استثناءات ولا تأثير على أي وظيفة أخرى في الخادم.
const enabled = Boolean(env.push.vapidPublicKey && env.push.vapidPrivateKey);

if (enabled) {
  webpush.setVapidDetails(env.push.vapidSubject, env.push.vapidPublicKey, env.push.vapidPrivateKey);
} else {
  console.warn("⚠️ إشعارات Push معطّلة: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY غير مضبوطين.");
}

export function isPushEnabled(): boolean {
  return enabled;
}

// المفتاح العام غير سرّي بطبيعته — المتصفح يحتاجه لإنشاء الاشتراك.
export function getPublicKey(): string {
  return env.push.vapidPublicKey;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  // إشعار مرتبط بموعد: الـService Worker يستعمل هذه الحقول لإغلاق الإشعار الظاهر عند انتهاء يوم الموعد.
  appointmentId?: string;
  appointmentDate?: string; // YYYY-MM-DD (يوم الموعد بتوقيت الجزائر)
  expiresAt?: string; // ISO — نهاية يوم الموعد بتوقيت الجزائر
  // نوع خاص يعامله الـService Worker بسلوك مختلف. حاليًا نوع واحد: تنبيه «قبل 5 دقائق» بنمط منبّه.
  // غيابه = إشعار عادي بالسلوك المعتاد تمامًا.
  kind?: typeof FIVE_MINUTE_ALARM_KIND;
  // آخر لحظة يفيد فيها تسليم الإشعار (ISO). إن وُجدت تحدّد TTL لدى خدمة الدفع بدل expiresAt:
  // تنبيه «بعد 5 دقائق» لا معنى له بعد بداية الموعد، فلا يُسلَّم متأخرًا لهاتف عاد للاتصال.
  deliverBy?: string;
  // أولوية التسليم لدى خدمة الدفع (ترويسة Urgency). "high" يوقظ الهاتف في وضع السكون (Doze) حيث يسمح النظام.
  urgency?: "very-low" | "low" | "normal" | "high";
}

export { FIVE_MINUTE_ALARM_KIND };

// الحد الأعلى الذي تقبله خدمات الدفع لمدة الاحتفاظ (4 أسابيع).
const MAX_TTL_SECONDS = 4 * 7 * 24 * 60 * 60;

/**
 * مدة بقاء الرسالة لدى خدمة الدفع (FCM/Mozilla/Apple) إن كان الهاتف غير متصل: حتى نهاية يوم الموعد فقط.
 * بعدها تُسقطها خدمة الدفع ولا تُسلَّم أبدًا، فلا يصل إشعار موعد انتهى إلى هاتف عاد للاتصال لاحقًا.
 * null = إشعار غير مرتبط بموعد (سلوك web-push الافتراضي كما كان). 0 أو أقل = منتهٍ، لا يُرسل إطلاقًا.
 */
export function pushTtlSeconds(payload: PushPayload, now: Date = new Date()): number | null {
  const until = payload.deliverBy ?? payload.expiresAt;
  if (!until) return null;
  const ms = new Date(until).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.min(MAX_TTL_SECONDS, Math.floor(ms / 1000));
}

/**
 * إرسال إشعار إلى كل أجهزة مستخدم معيّن (قد يستعمل الطبيب هاتفه وحاسوبه معًا).
 *
 * قاعدتان مهمتان:
 * 1) الاشتراك الذي ترفضه خدمة الدفع نهائيًا (404/410 أي أن المتصفح أزاله) يُحذف تلقائيًا
 *    حتى لا تتراكم اشتراكات ميتة في القاعدة.
 * 2) الدالة لا ترمي استثناءً أبدًا: فشل الإشعار يجب ألا يُفشل عملية الحجز أو أي طلب آخر.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!enabled) return { sent: 0, removed: 0 };

  // لا إرسال لإشعار موعد انتهى يومه (حارس أخير مهما كان المسار الذي استدعى الدالة).
  const ttl = pushTtlSeconds(payload);
  if (ttl !== null && ttl <= 0) return { sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;

  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });

    await Promise.all(
      subs.map(async (s) => {
        try {
          const target = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
          const options: webpush.RequestOptions = {};
          if (ttl !== null) options.TTL = ttl;
          if (payload.urgency) options.urgency = payload.urgency;
          if (Object.keys(options).length === 0) await webpush.sendNotification(target, JSON.stringify(payload));
          else await webpush.sendNotification(target, JSON.stringify(payload), options);
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
            removed += 1;
          } else {
            console.error("فشل إرسال إشعار Push:", status ?? (err as Error)?.message);
          }
        }
      })
    );
  } catch (err) {
    console.error("تعذّر جلب اشتراكات الإشعارات:", err);
  }

  return { sent, removed };
}
