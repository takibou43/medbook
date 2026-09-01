import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Role } from "../types";
import { Spinner } from "../components/ui/States";

export function ProtectedRoute({ allow }: { allow: Role[] }) {
  const { user, loading } = useAuth();

  if (loading) return <Spinner label="جارٍ التحقق من الجلسة..." />;
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) return <Navigate to="/" replace />;

  return <Outlet />;
}
