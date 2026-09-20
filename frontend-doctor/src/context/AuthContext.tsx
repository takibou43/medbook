import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, setAccessToken, getAccessToken, classifyApiError, ApiErrorKind } from "../lib/api";
import { User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  // صحيح عندما يفشل التحقق من الجلسة لسبب شبكي (لا لانتهاء الجلسة): نعرض عندها شاشة
  // إعادة محاولة بدل إخراج الطبيب من حسابه أو تركه أمام دائرة تحميل لا تنتهي.
  sessionError: boolean;
  // سبب الفشل غير المرتبط بانتهاء الجلسة (انقطاع فعلي / لا يصل الخادم / مهلة / 429 / 5xx) لعرض رسالة دقيقة.
  sessionErrorKind: ApiErrorKind | null;
  login: (email: string, password: string) => Promise<User>;
  registerDoctor: (data: Record<string, unknown>) => Promise<User>;
  registerAssistant: (data: { token: string; password: string; firstName: string; lastName: string }) => Promise<User>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [sessionErrorKind, setSessionErrorKind] = useState<ApiErrorKind | null>(null);

  const refreshMe = useCallback(async () => {
    if (!getAccessToken()) {
      setSessionError(false);
      setSessionErrorKind(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSessionError(false);
    setSessionErrorKind(null);
    try {
      const res = await api.get("/auth/me");
      setUser(res.data.data);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        // الجلسة منتهية فعلًا — نمسحها ونعيد المستخدم إلى تسجيل الدخول.
        setAccessToken(null);
        setUser(null);
      } else {
        // عطل شبكة أو مهلة (خادم نائم مثلًا): نحتفظ بالجلسة ونعرض إمكانية إعادة المحاولة
        // بدل تسجيل خروج غير مبرَّر.
        setSessionError(true);
        setSessionErrorKind(classifyApiError(err).kind);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  async function login(email: string, password: string) {
    const res = await api.post("/auth/login", { email, password });
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    setSessionError(false);
    return res.data.data.user as User;
  }

  async function registerDoctor(data: Record<string, unknown>) {
    const res = await api.post("/auth/register/doctor", data);
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    setSessionError(false);
    return res.data.data.user as User;
  }

  async function registerAssistant(data: { token: string; password: string; firstName: string; lastName: string }) {
    const res = await api.post("/auth/register/assistant", data);
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    setSessionError(false);
    return res.data.data.user as User;
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } finally {
      setAccessToken(null);
      setUser(null);
      setSessionError(false);
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, sessionError, sessionErrorKind, login, registerDoctor, registerAssistant, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth يجب أن يُستخدم داخل AuthProvider");
  return ctx;
}
