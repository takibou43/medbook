import webpush from "web-push";
import { prisma } from "./prisma";
import { env } from "../config/env";

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

  let sent = 0;
  let removed = 0;

  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload)
          );
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
