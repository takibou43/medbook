import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LucideIcon, Stethoscope, LogOut } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../../context/AuthContext";

export interface DashboardNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export function DashboardLayout({ title, items }: { title: string; items: DashboardNavItem[] }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 border-l border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5 text-primary-700">
          <div className="rounded-xl bg-primary-600 p-1.5 text-white">
            <Stethoscope className="h-5 w-5" />
          </div>
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
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="btn-ghost w-full justify-start"
          >
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5 md:hidden">
          <span className="text-lg font-extrabold text-primary-700">MedBook</span>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="btn-ghost"
          >
            <LogOut className="h-4 w-4" />
            خروج
          </button>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
