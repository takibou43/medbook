import type { CapacitorConfig } from "@capacitor/cli";

// تطبيق أندرويد لموقع المريض (مادبوك). نفس كود React يُحزَّم داخل التطبيق (dist)،
// ويتصل بنفس الخادم https://medbook-xg66.onrender.com/api (يُضبط عبر VITE_API_URL وقت البناء).
// أصل الصفحات داخل التطبيق هو https://localhost — يجب أن يكون ضمن CLIENT_URL على الخادم.
const config: CapacitorConfig = {
  appId: "com.madbook.patient",
  appName: "مادبوك",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    // لا تصحيح عن بُعد للـWebView في النسخ الموزّعة.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
