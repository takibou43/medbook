import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LucideIcon, LogOut, Menu, X } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../../context/AuthContext";
import { Logo } from "../ui/Logo";

export interface DashboardNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export function DashboardLayout({ title, items }: { title: string; items: DashboardNavItem[] }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  // روابط التنقّل (مثل "المواعيد") كانت موجودة فقط داخل الشريط الجانبي المخفي على الهاتف
  // (hidden md:flex)، فلم يكن هناك أي وسيلة للوصول إليها على الشاشات الصغيرة. أضفنا قائمة
  // منسدلة تُفتح بزر همبرغر في الترويسة على الهاتف وتحتوي نفس الروابط.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 border-l border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5 text-primary-700">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-extrabold">MedBook</span>
        </div>
        <p className="px-5 pt-4 text-xs font-semibold uppercase text-slate-400">{title}</p>
        <nav className="flex-1 space-y-1 p-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-100"
                )
              }
            >
              <item.icon className="h-4.5 w-4.5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <button onClick={handleLogout} className="btn-ghost w-full justify-start">
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5 md:hidden">
          <div className="flex items-center gap-2 text-primary-700">
            <Logo className="h-7 w-7" />
            <span className="text-lg font-extrabold">MedBook</span>
          </div>
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="btn-ghost"
            aria-label={mobileMenuOpen ? "إغلاق القائمة" : "فتح القائمة"}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>

        {mobileMenuOpen && (
          <nav className="space-y-1 border-b border-slate-200 bg-white p-3 md:hidden">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                    isActive ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-100"
                  )
                }
              >
                <item.icon className="h-4.5 w-4.5" />
                {item.label}
              </NavLink>
            ))}
            <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              <LogOut className="h-4 w-4" />
              تسجيل الخروج
            </button>
          </nav>
        )}

        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
