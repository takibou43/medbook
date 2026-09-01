import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Role } from "../types";
import { Spinner } from "../components/ui/States";

export function ProtectedRoute({ allow }: { allow: Role[] }) {
  const { user, loading } = useAuth();

  if (loading) return <Spinner label="جارٍ التحقق من الجلسة..." />;
  if (!user) return <Navigate to="/login" replace />;
  // موقع الأطباء لوحة تحكم فقط (لا صفحة عامة "/")، لذا أي دور غير مسموح به يُعاد توجيهه لتسجيل الدخول
  // بدل الجذر "/" تفاديًا لأي احتمال حلقة توجيه.
  if (!allow.includes(user.role)) return <Navigate to="/login" replace />;

  return <Outlet />;
}
