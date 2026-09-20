import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // لإرسال cookie الخاص بـ refresh token
  // مهلة قصوى لكل طلب: بدونها يبقى الطلب معلّقًا إلى ما لا نهاية على شبكات الهاتف
  // الضعيفة أو عندما يكون خادم الاستضافة المجاني نائمًا، فتتجمّد شاشة "جارٍ التحقق من
  // الجلسة" بلا رسالة خطأ. 30 ثانية تكفي حتى لأبطأ استيقاظ للخادم، وما بعدها يُعتبر فشلًا
  // قابلًا لإعادة المحاولة.
  // 45 ثانية وليس 30: إيقاظ الخادم المجاني من السكون وحده يستغرق 30–50 ثانية.
  timeout: 45000,
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

// ===== تصنيف أخطاء الـAPI: رسالة دقيقة حسب السبب الحقيقي =====
// لا نُخفي خطأ الخادم ولا نعتبر المستخدم "متصلًا" اصطناعيًا: نقرأ navigator.onLine فقط لنميّز
// جهازًا بلا شبكة فعلًا (offline) عن جهاز متصل لا يصله الخادم (network)، ونعتمد على رمز الحالة
// (429/5xx) وعلى رمز المهلة لباقي الحالات.
export type ApiErrorKind = "offline" | "timeout" | "network" | "rateLimited" | "server" | "other";

export const API_MESSAGES = {
  offline: "لا يوجد اتصال بالإنترنت.",
  timeout: "استغرق الاتصال بخادم مادبوك وقتًا أطول من المتوقع.",
  network: "تعذّر الاتصال بخادم مادبوك. حاول مرة أخرى بعد قليل.",
  rateLimited: "عدد الطلبات كبير حاليًا. انتظر قليلًا ثم أعد المحاولة.",
  server: "حدث خطأ مؤقت في خادم مادبوك. حاول مرة أخرى.",
} as const;

export function classifyApiError(error: unknown): { kind: ApiErrorKind; status?: number } {
  const e = error as any;
  const status: number | undefined = e?.response?.status;
  if (status) {
    if (status === 429) return { kind: "rateLimited", status };
    if (status >= 500) return { kind: "server", status };
    return { kind: "other", status };
  }
  if (e?.code === "ECONNABORTED" || e?.code === "ETIMEDOUT") return { kind: "timeout" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline" };
  return { kind: "network" };
}

export function apiErrorMessage(error: unknown, fallback = "حدث خطأ غير متوقع."): string {
  const anyErr = error as any;
  const { kind } = classifyApiError(error);
  if (kind !== "other") return API_MESSAGES[kind];
  // 4xx: رسالة الخادم العربية مكتوبة للمستخدم (بيانات غير صحيحة، غير مصرَّح...) فتُعرض كما هي.
  const serverMsg = anyErr?.response?.data?.message;
  return typeof serverMsg === "string" && serverMsg ? serverMsg : fallback;
}
