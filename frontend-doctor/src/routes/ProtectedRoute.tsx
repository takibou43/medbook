import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { RefreshCw, WifiOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Role } from "../types";
import { Spinner } from "../components/ui/States";

// شاشة انتظار التحقق من الجلسة: بعد بضع ثوانٍ نطمئن المستخدم بأن أول فتح قد يكون بطيئًا
// (خادم الاستضافة ينام عند عدم الاستعمال ويحتاج وقتًا ليستيقظ)، حتى لا يظن أن الموقع معطّل.
function SessionLoading() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <Spinner label="جارٍ التحقق من الجلسة..." />
      {slow && (
        <p className="max-w-xs text-xs leading-relaxed text-slate-500">
          قد يستغرق أول فتح حتى دقيقة لأن الخادم يستيقظ من وضع السكون. أبقِ الصفحة مفتوحة.
        </p>
      )}
    </div>
  );
}

// عند فشل التحقق لسبب شبكي (انقطاع إنترنت أو انتهاء مهلة الطلب) لا نُخرج الطبيب من حسابه
// ولا نتركه أمام دائرة تحميل لا تنتهي — نعرض سبب المشكلة وزر إعادة محاولة.
function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff className="h-10 w-10 text-slate-400" />
      <p className="text-lg font-extrabold text-slate-900">تعذّر الاتصال بالخادم</p>
      <p className="max-w-xs text-sm leading-relaxed text-slate-500">
        تحقق من اتصالك بالإنترنت ثم أعد المحاولة. جلستك لم تُلغَ.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
      >
        <RefreshCw className="h-4 w-4" /> إعادة المحاولة
      </button>
    </div>
  );
}

export function ProtectedRoute({ allow }: { allow: Role[] }) {
  const { user, loading, sessionError, refreshMe } = useAuth();

  if (loading) return <SessionLoading />;
  if (sessionError) return <SessionError onRetry={() => void refreshMe()} />;
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) {
    return <Navigate to={user.role === "ADMIN" ? "/admin" : "/"} replace />;
  }

  return <Outlet />;
}
