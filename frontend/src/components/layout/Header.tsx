import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { Link, NavLink } from "react-router-dom";
import { Camera, UserRound } from "lucide-react";
import { Logo } from "../ui/Logo";
import { useAuth } from "../../context/AuthContext";

export function Header() {
  useLanguage();
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95">
      <div className="container-app flex min-h-16 items-center justify-between gap-1">
        <Link to="/" className="flex min-h-[48px] items-center gap-2 text-primary-700">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-extrabold">MedBook</span>
        </Link>
        {/* صفحة «تتبّع حجزي» (/track) حُذفت نهائيًا في 2026-09-28: لم يكن لها مسار ولا رابط، والحجز يتطلب حسابًا
            الآن فيتابع المريض مواعيده من «حسابي». حجوزات الضيوف القديمة تبقى قابلة للاستعلام عبر
            GET /api/booking/lookup (معرّف الموعد + الهاتف) فقط. */}
        {/* حساب المريض (مطلوب لإتمام الحجز): رابط واحد صغير لا يزاحم خطوات الحجز. */}
        <NavLink to="/clinics" className={({ isActive }) => `flex min-h-[48px] items-center rounded-xl px-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 ${isActive ? "bg-primary-50" : ""}`}>{t("العيادات")}</NavLink>
        <NavLink to="/account/arrival" aria-label={t("تسجيل الوصول بالمسح")} title={t("تسجيل الوصول بالمسح")} className={({ isActive }) => `flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-primary-700 hover:bg-primary-50 ${isActive ? "bg-primary-50" : ""}`}>
          <Camera className="h-6 w-6" aria-hidden="true" />
        </NavLink>
        {!loading && (
          <Link
            to={user ? "/account" : "/account/login"}
            aria-label={user ? t("حسابي") : t("تسجيل الدخول")}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-primary-700 hover:bg-white/70"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            <span className="hidden min-[360px]:inline">{user ? t("حسابي") : t("تسجيل الدخول")}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
