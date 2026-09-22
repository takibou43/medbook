import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import { Logo } from "../ui/Logo";
import { useAuth } from "../../context/AuthContext";

export function Header() {
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-white/50 backdrop-blur-md">
      <div className="container-app flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-primary-700">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-extrabold">MedBook</span>
        </Link>
        {/* رابط "تتبّع حجزي" مخفي مؤقتًا من الترويسة بطلب صريح — الصفحة والمسار /track
            ما زالا يعملان، فقط لا يوجد رابط ظاهر إليهما حاليًا. */}
        {/* حساب المريض اختياري: رابط واحد صغير لا يزاحم خطوات الحجز. */}
        {!loading && (
          <Link
            to={user ? "/account" : "/account/login"}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-primary-700 hover:bg-white/70"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            {user ? "حسابي" : "تسجيل الدخول"}
          </Link>
        )}
      </div>
    </header>
  );
}
