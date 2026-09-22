import { api } from "./api";

// إشعارات المتصفح لحساب المريض (تذكير قبل الموعد بساعة وقبل 5 دقائق).
// نفس آلية موقع الأطباء (Web Push + VAPID عبر الـService Worker الموجود) — بلا Firebase ولا أي خدمة مدفوعة.

export type PushState = "unsupported" | "denied" | "enabled" | "disabled";

// مفتاح VAPID العام يصل بصيغة base64url، وPushManager يطلبه بايتات خامًا (ArrayBuffer).
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
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** حالة الإشعارات على هذا الجهاز — لا تطلب أي إذن (آمنة للاستدعاء عند فتح الصفحة). */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const sub = await currentSubscription();
    return sub && Notification.permission === "granted" ? "enabled" : "disabled";
  } catch {
    return "disabled";
  }
}

/**
 * تفعيل الإشعارات: يجب استدعاؤها من ضغطة زر مباشرة (المتصفحات ترفض طلب الإذن خارج تفاعل المستخدم).
 * لا تُظهر أي نافذة إذن من تلقاء نفسها — المريض هو من يضغط «تفعيل الإشعارات».
 */
export async function enablePatientPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) {
    return { ok: false, reason: "متصفحك لا يدعم الإشعارات. على آيفون: أضِف الموقع إلى الشاشة الرئيسية ثم افتحه منها." };
  }

  const res = await api.get<{ data: { publicKey: string; enabled: boolean } }>("/push/public-key");
  const { publicKey, enabled } = res.data.data;
  if (!enabled || !publicKey) return { ok: false, reason: "الإشعارات غير مفعّلة على الخادم بعد." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "لم تُمنح صلاحية الإشعارات. يمكنك السماح بها من إعدادات الموقع في المتصفح ثم المحاولة مجددًا." };
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToArrayBuffer(publicKey) }));

  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: "تعذّر إنشاء اشتراك صالح للإشعارات." };
  }

  await api.post("/patient/notifications/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return { ok: true };
}

/** إيقاف الإشعارات على هذا الجهاز فقط (تبقى على أجهزة المريض الأخرى). */
export async function disablePatientPush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await api.delete("/patient/notifications/subscribe", { data: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

export async function sendTestPush(): Promise<void> {
  await api.post("/patient/notifications/test");
}
