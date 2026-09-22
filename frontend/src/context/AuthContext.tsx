import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, setAccessToken, getAccessToken } from "../lib/api";
import { User } from "../types";

// حساب المريض في موقع المرضى: كل الطلبات عبر /api/patient/auth (مقصورة على دور المريض، وجلسة
// تجديد منفصلة عن جلسة الأطباء). إنشاء حجز يتطلب حساب مريض مسجّل الدخول (يُفرض في الخادم أيضًا).
export interface PatientRegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  registerPatient: (data: PatientRegisterInput | Record<string, unknown>) => Promise<User>;
  registerDoctor: (data: Record<string, unknown>) => Promise<User>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.get("/patient/auth/me");
      setUser(res.data.data);
    } catch {
      setAccessToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // انتهاء الجلسة نهائيًا (فشل التجديد) من أي طلب في أي صفحة.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("medbook:session-expired", onExpired);
    return () => window.removeEventListener("medbook:session-expired", onExpired);
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post("/patient/auth/login", { email, password });
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    return res.data.data.user as User;
  }

  async function registerPatient(data: PatientRegisterInput | Record<string, unknown>) {
    const res = await api.post("/patient/auth/register", data);
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    return res.data.data.user as User;
  }

  // تبقى لتوافق صفحات قديمة غير موصولة بأي مسار (لا تُستعمل في موقع المرضى الحالي).
  async function registerDoctor(data: Record<string, unknown>) {
    const res = await api.post("/auth/register/doctor", data);
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    return res.data.data.user as User;
  }

  async function logout() {
    try {
      await api.post("/patient/auth/logout");
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, registerPatient, registerDoctor, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth يجب أن يُستخدم داخل AuthProvider");
  return ctx;
}
