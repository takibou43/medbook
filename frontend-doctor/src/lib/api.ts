import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // لإرسال cookie الخاص بـ refresh token
  // مهلة قصوى لكل طلب: بدونها يبقى الطلب معلّقًا إلى ما لا نهاية على شبكات الهاتف
  // الضعيفة أو عندما يكون خادم الاستضافة المجاني نائمًا، فتتجمّد شاشة "جارٍ التحقق من
  // الجلسة" بلا رسالة خطأ. 30 ثانية تكفي حتى لأبطأ استيقاظ للخادم، وما بعدها يُعتبر فشلًا
  // قابلًا لإعادة المحاولة.
  timeout: 30000,
});

let accessToken: string | null = localStorage.getItem("medbook_doctor_access_token");

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem("medbook_doctor_access_token", token);
  else localStorage.removeItem("medbook_doctor_access_token");
}

export function getAccessToken() {
  return accessToken;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let refreshingPromise: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    // طلب تجديد الجلسة نفسه لا يجوز أن يمرّ عبر منطق التجديد: إن ردّ بـ401 (كوكي التجديد
    // منتهٍ أو محجوب كطرف ثالث في متصفح الهاتف) فسينتظر هذا المعترِض نفس الوعد الذي لم
    // ينتهِ بعد — انتظار متبادل يجمّد التطبيق للأبد عند شاشة "جارٍ التحقق من الجلسة".
    const isRefreshCall = typeof original?.url === "string" && original.url.includes("/auth/refresh");

    if (error.response?.status === 401 && !original._retry && !isRefreshCall) {
      original._retry = true;
      try {
        if (!refreshingPromise) {
          refreshingPromise = api
            .post("/auth/refresh")
            .then((res) => {
              const token = res.data?.data?.accessToken as string;
              setAccessToken(token);
              return token;
            })
            .catch(() => {
              setAccessToken(null);
              return null;
            })
            .finally(() => {
              refreshingPromise = null;
            });
        }
        const newToken = await refreshingPromise;
        if (newToken) {
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        }
      } catch {
        // fallthrough to reject below
      }
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error: unknown, fallback = "حدث خطأ غير متوقع."): string {
  const anyErr = error as any;
  if (anyErr?.code === "ECONNABORTED") return "انتهت مهلة الاتصال بالخادم. تحقق من الإنترنت وأعد المحاولة.";
  if (anyErr?.response?.data?.message) return anyErr.response.data.message;
  if (anyErr?.message === "Network Error") return "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.";
  return anyErr?.message ?? fallback;
}
