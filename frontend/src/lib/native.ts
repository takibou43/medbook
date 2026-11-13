// طبقة التطبيق الأصلي (أندرويد عبر Capacitor). في المتصفح العادي كل الدوال هنا لا تفعل شيئًا،
// فيبقى سلوك الموقع على Vercel كما هو تمامًا.
import { Capacitor } from "@capacitor/core";

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * الإشعارات الأصلية (Firebase Cloud Messaging) لا تُفعَّل إلا إذا بُني التطبيق بملف google-services.json
 * (VITE_NATIVE_PUSH=true). بدونه يتعطّل التطبيق عند تسجيل الإشعارات، لذلك نحرسه بهذه العلامة.
 */
export function nativePushAvailable(): boolean {
  return isNativeApp() && import.meta.env.VITE_NATIVE_PUSH === "true";
}

type Navigate = (delta: number) => void;

/** يُستدعى مرة واحدة عند بدء التطبيق: زر الرجوع في أندرويد + لون شريط الحالة. */
export async function initNativeShell(goBack: Navigate): Promise<void> {
  if (!isNativeApp()) return;
  document.documentElement.classList.add("mb-native");

  const [{ App }, { StatusBar, Style }] = await Promise.all([import("@capacitor/app"), import("@capacitor/status-bar")]);

  // زر الرجوع: يرجع صفحة داخل التطبيق، ومن الصفحة الرئيسية يخرج من التطبيق بدل أن يبقى معلقًا.
  App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== "/") goBack(-1);
    else App.exitApp();
  }).catch(() => undefined);

  StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  StatusBar.setBackgroundColor({ color: "#187f77" }).catch(() => undefined);
}

/**
 * تسجيل الإشعارات الأصلية: يطلب الإذن ثم يرسل رمز الجهاز (FCM token) إلى الخادم.
 * يجب استدعاؤها من ضغطة المريض على «تفعيل الإشعارات».
 */
export async function enableNativePush(sendToken: (token: string) => Promise<void>): Promise<{ ok: boolean; reason?: string }> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") return { ok: false, reason: "denied" };

  const token = await new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), 20000);
    PushNotifications.addListener("registration", (t) => {
      window.clearTimeout(timer);
      resolve(t.value);
    });
    PushNotifications.addListener("registrationError", (e) => {
      window.clearTimeout(timer);
      reject(new Error(e.error));
    });
    PushNotifications.register().catch(reject);
  });
  await sendToken(token);
  return { ok: true };
}

export async function nativePushState(): Promise<"enabled" | "disabled" | "denied"> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === "denied") return "denied";
  return perm.receive === "granted" && localStorage.getItem("medbook_native_push") === "1" ? "enabled" : "disabled";
}
