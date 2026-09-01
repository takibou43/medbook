import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, setAccessToken, getAccessToken } from "../lib/api";
import { User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  registerPatient: (data: Record<string, unknown>) => Promise<User>;
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
      const res = await api.get("/auth/me");
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

  async function login(email: string, password: string) {
    const res = await api.post("/auth/login", { email, password });
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    return res.data.data.user as User;
  }

  async function registerPatient(data: Record<string, unknown>) {
    const res = await api.post("/auth/register/patient", data);
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    return res.data.data.user as User;
  }

  async function registerDoctor(data: Record<string, unknown>) {
    const res = await api.post("/auth/register/doctor", data);
    setAccessToken(res.data.data.accessToken);
    setUser(res.data.data.user);
    return res.data.data.user as User;
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
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
