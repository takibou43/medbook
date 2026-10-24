import { useLanguage, LanguageSwitcher } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { Link, NavLink } from "react-router-dom";
import { ScanLine, UserRound } from "lucide-react";
import { Logo } from "../ui/Logo";
import { useAuth } from "../../context/AuthContext";

export function Header() {
  useLanguage();
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b glass-chrome border-white/70">
      <div className="container-app flex min-h-16 items-center justify-between gap-0.5">
        <Link to="/" aria-label="MedBook" className="flex min-h-[48px] shrink-0 items-center gap-1 text-primary-700">
          <Logo className="h-7 w-7 sm:h-8 sm:w-8" />
          <span className="text-sm font-extrabold sm:text-lg">MedBook</span>
        </Link>
        {/* صفحة «تتبّع حجزي» (/track) حُذفت نهائيًا في 2026-09-28: لم يكن لها مسار ولا رابط، والحجز يتطلب حسابًا
            الآن فيتابع المريض مواعيده من «حسابي». حجوزات الضيوف القديمة تبقى قابلة للاستعلام عبر
            GET /api/booking/lookup (معرّف الموعد + الهاتف) فقط. */}
        {/* حساب المريض (مطلوب لإتمام الحجز): رابط واحد صغير لا يزاحم خطوات الحجز. */}
        <NavLink to="/clinics" className={({ isActive }) => `flex min-h-[48px] items-center rounded-xl px-1 text-xs font-semibold sm:px-2 sm:text-sm text-primary-700 hover:bg-primary-50 ${isActive ? "bg-primary-50" : ""}`}>{t("العيادات")}</NavLink>
        <NavLink to="/account/arrival" aria-label={t("مسح QR لتسجيل الوصول")} title={t("مسح QR لتسجيل الوصول")} className={({ isActive }) => `flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-xl text-primary-700 hover:bg-primary-50 ${isActive ? "bg-primary-50" : ""}`}>
          <ScanLine className="h-5 w-5" aria-hidden="true" />
          <span className="text-[10px] font-semibold leading-3">QR</span>
        </NavLink>
        <LanguageSwitcher />
        {!loading && (
          <Link
            to={user ? "/account" : "/account/login"}
            aria-label={user ? t("حسابي") : t("تسجيل الدخول")}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-1.5 text-sm font-semibold text-primary-700 hover:bg-white/70"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{user ? t("حسابي") : t("تسجيل الدخول")}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
