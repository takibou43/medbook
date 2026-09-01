import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // لإرسال cookie الخاص بـ refresh token
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
    if (error.response?.status === 401 && !original._retry) {
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
  return anyErr?.response?.data?.message ?? anyErr?.message ?? fallback;
}
