import { api } from "./api";

// مفتاح VAPID العام يصل بصيغة base64url، وواجهة PushManager تطلبه بايتات خامًا.
// نُرجِع ArrayBuffer وليس Uint8Array لأن تعريفات TypeScript الحديثة ترفض Uint8Array<ArrayBufferLike>
// في خانة applicationServerKey (تقبل BufferSource فقط)، وهذا ما أوقف بناء الموقع أول مرة.
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  return Boolean(await reg.pushManager.getSubscription());
}

/**
 * تفعيل إشعارات المتصفح على هذا الجهاز.
 *
 * يجب استدعاؤها من ضغطة زر مباشرة: المتصفحات ترفض طلب الإذن خارج تفاعل المستخدم،
 * والرفض الأول يُعطّل الطلب لاحقًا للموقع كله.
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) {
    return {
      ok: false,
      reason: "متصفحك لا يدعم إشعارات المتصفح. على آيفون أضِف الموقع إلى الشاشة الرئيسية ثم أعد المحاولة.",
    };
  }

  const res = await api.get<{ data: { publicKey: string; enabled: boolean } }>("/push/public-key");
  const { publicKey, enabled } = res.data.data;
  if (!enabled || !publicKey) {
    return { ok: false, reason: "الإشعارات غير مفعّلة على الخادم بعد." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "لم تُمنح صلاحية الإشعارات. يمكنك تفعيلها من إعدادات الموقع في المتصفح." };
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(publicKey),
    }));

  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: "تعذّر إنشاء اشتراك صالح للإشعارات." };
  }

  await api.post("/push/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });

  return { ok: true };
}

/** إيقاف الإشعارات على هذا الجهاز فقط (تبقى على أجهزته الأخرى). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = reg ? await reg.pushManager.getSubscription() : null;
  if (!subscription) return;
  await api.post("/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
