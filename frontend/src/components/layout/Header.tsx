import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Stethoscope, Menu, X, Bell, LogOut, LayoutDashboard } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import clsx from "clsx";

const NAV_LINKS = [
  { to: "/", label: "الرئيسية" },
  { to: "/doctors", label: "الأطباء" },
  { to: "/specialties", label: "التخصصات" },
  { to: "/how-it-works", label: "كيف يعمل؟" },
];

function dashboardPathFor(role?: string) {
  if (role === "DOCTOR") return "/doctor";
  if (role === "ADMIN") return "/admin";
  return "/patient";
}

export function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="container-app flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-primary-700">
          <div className="rounded-xl bg-primary-600 p-1.5 text-white">
            <Stethoscope className="h-5 w-5" />
          </div>
          <span className="text-lg font-extrabold">MedBook</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                clsx("text-sm font-medium transition", isActive ? "text-primary-700" : "text-slate-600 hover:text-primary-700")
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <>
              <button
                onClick={() => navigate(dashboardPathFor(user.role))}
                className="btn-outline"
              >
                <LayoutDashboard className="h-4 w-4" />
                لوحتي
              </button>
              <button onClick={() => logout()} className="btn-ghost">
                <LogOut className="h-4 w-4" />
                خروج
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost">
                تسجيل الدخول
              </Link>
              <Link to="/register" className="btn-primary">
                إنشاء حساب
              </Link>
            </>
          )}
        </div>

        <button className="md:hidden" onClick={() => setOpen((o) => !o)}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white px-4 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {NAV_LINKS.map((l) => (
              <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="text-sm font-medium text-slate-700">
                {l.label}
              </Link>
            ))}
            <hr />
            {user ? (
              <>
                <button className="btn-outline w-full" onClick={() => { setOpen(false); navigate(dashboardPathFor(user.role)); }}>
                  لوحتي
                </button>
                <button className="btn-ghost w-full" onClick={() => { setOpen(false); logout(); }}>
                  تسجيل الخروج
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setOpen(false)} className="btn-outline w-full">
                  تسجيل الدخول
                </Link>
                <Link to="/register" onClick={() => setOpen(false)} className="btn-primary w-full">
                  إنشاء حساب
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export { Bell };
