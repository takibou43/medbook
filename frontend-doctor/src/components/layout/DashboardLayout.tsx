import { useEffect, useLayoutEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigationType, useNavigate } from "react-router-dom";
import { LucideIcon, LogOut, Menu, X } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../../context/AuthContext";
import { Logo } from "../ui/Logo";

const scrollPositions = new Map<string, number>();

export interface DashboardNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** عدّاد صغير بجانب الرابط (مثل الرسائل غير المقروءة). لا يظهر إن كان 0 أو غير معرّف. */
  badge?: number;
}

export function DashboardLayout({
  title,
  subtitle,
  items,
  dailyNavigation = false,
  settingsStart,
  clinicMode = false,
}: {
  title: string;
  /** شارة اختيارية تحت العنوان (مثل "مساعد لدى د. ..."). لا تُعرض إن لم تُمرَّر. */
  subtitle?: string;
  items: DashboardNavItem[];
  dailyNavigation?: boolean;
  settingsStart?: number;
  clinicMode?: boolean;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const listLocation = location.pathname + location.search;
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (settingsStart !== undefined && items.slice(settingsStart).some(i => location.pathname === i.to.split('?')[0])) setSettingsOpen(true); }, [location.pathname, settingsStart]);
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => { history.scrollRestoration = previous; };
  }, []);
  useEffect(() => {
    const remember = () => scrollPositions.set(listLocation, window.scrollY);
    window.addEventListener('scroll', remember, {passive:true});
    return () => window.removeEventListener('scroll',remember);
  }, [listLocation]);
  useLayoutEffect(() => {
    const top = navigationType === 'POP' ? scrollPositions.get(listLocation) ?? 0 : 0;
    window.scrollTo({top,behavior:'instant'});
    // Cached queries render on the next frame; allow a short retry if the list is not tall yet.
    const frame = requestAnimationFrame(() => window.scrollTo({top,behavior:'instant'}));
    const timer = window.setTimeout(() => window.scrollTo({top,behavior:'instant'}),100);
    return () => {cancelAnimationFrame(frame);window.clearTimeout(timer);};
  }, [location.pathname]);
  // روابط التنقّل (مثل "المواعيد") كانت موجودة فقط داخل الشريط الجانبي المخفي على الهاتف
  // (hidden md:flex)، فلم يكن هناك أي وسيلة للوصول إليها على الشاشات الصغيرة. أضفنا قائمة
  // منسدلة تُفتح بزر همبرغر في الترويسة على الهاتف وتحتوي نفس الروابط.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    const main = document.getElementById('main-content');
    if (mobileMenuOpen) main?.setAttribute('inert',''); else main?.removeAttribute('inert');
    const escape = (event: KeyboardEvent) => { if(event.key === 'Escape') setMobileMenuOpen(false); };
    window.addEventListener('keydown',escape);
    return () => {main?.removeAttribute('inert');window.removeEventListener('keydown',escape);};
  }, [mobileMenuOpen]);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-[100] focus:rounded-xl focus:bg-white focus:p-3">انتقل إلى المحتوى</a>
      <aside className="hidden w-64 shrink-0 border-l border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5 text-primary-700">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-extrabold">مادبوك / MadBook</span>
        </div>
        <p className="px-5 pt-4 text-xs font-semibold uppercase text-slate-400">{title}</p>
        {subtitle && (
          <p className="mx-5 mt-2 truncate rounded-lg bg-primary-50 px-2.5 py-1.5 text-xs font-semibold text-primary-700" title={subtitle}>
            {subtitle}
          </p>
        )}
        {clinicMode && <div className="mx-3 mt-3 flex gap-2 rounded-xl bg-slate-50 p-2 text-sm"><NavLink className="flex-1 rounded-lg bg-primary-50 p-2 text-primary-700" to="/">وضع الطبيب</NavLink><NavLink className="flex-1 rounded-lg p-2" to="/clinic">إدارة العيادة</NavLink></div>}
        <nav className="flex-1 space-y-1 p-3">
          {items.map((item, index) => (
            <div key={item.to}>
            {index === settingsStart && <button aria-expanded={settingsOpen} className="w-full rounded-xl px-3 pb-2 pt-4 text-right text-sm font-bold text-slate-700" onClick={() => setSettingsOpen(v => !v)}>الإدارة والإعدادات {settingsOpen ? '−' : '+'}</button>}
            {(settingsStart === undefined || index < settingsStart || settingsOpen) &&
            <NavLink
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
              {item.badge ? (
                <span className="mr-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{item.badge}</span>
              ) : null}
            </NavLink>}</div>
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
            <span className="text-lg font-extrabold">مادبوك / MadBook</span>
          </div>
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="btn-ghost"
            aria-label={mobileMenuOpen ? "إغلاق القائمة" : "فتح القائمة"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>

        {mobileMenuOpen && (
          <nav className="fixed inset-x-0 top-16 bottom-20 z-50 overflow-y-auto space-y-1 border-b border-slate-200 bg-white p-3 md:hidden">
            {items.map((item, index) => (
              <div key={item.to}>
              {index === settingsStart && <button aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)} className="w-full rounded-xl p-3 text-right font-bold text-slate-700">الإدارة والإعدادات {settingsOpen ? '−' : '+'}</button>}
              {(settingsStart === undefined || index < settingsStart || settingsOpen) &&
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
                {item.badge ? (
                  <span className="mr-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{item.badge}</span>
                ) : null}
              </NavLink>}
              </div>
            ))}
            {clinicMode && <NavLink to="/clinic" onClick={() => setMobileMenuOpen(false)} className="block rounded-xl p-3 text-primary-700">إدارة العيادة</NavLink>}
            <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              <LogOut className="h-4 w-4" />
              تسجيل الخروج
            </button>
          </nav>
        )}

        {/* min-w-0 + overflow-x-hidden: خط دفاع أخير حتى لا يُخرج أي عنصر عريض (رابط طويل،
            جدول، رقم غير قابل للقصّ) الصفحة كاملة عن عرض شاشة الهاتف. */}
        <main id="main-content" tabIndex={-1} className={clsx("min-w-0 flex-1 overflow-x-hidden p-4 md:p-8", dailyNavigation && "pb-24 md:pb-8")}>
          <Outlet />
        </main>
        {dailyNavigation && <nav aria-label="التنقل اليومي" className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          {items.slice(0, settingsStart ?? 2).map(item => <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMobileMenuOpen(false)} className={({isActive}) => clsx("relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[11px]", isActive ? "text-primary-700 bg-primary-50" : "text-slate-600")}><item.icon className="h-5 w-5"/><span>{item.label}</span>{item.badge ? <span className="absolute top-1 rounded-full bg-red-500 px-1 text-white">{item.badge}</span> : null}</NavLink>)}
          <button aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(v => !v)} className="flex flex-1 flex-col items-center gap-1 py-3 text-[11px]"><Menu className="h-5 w-5"/>المزيد</button>
        </nav>}
      </div>
    </div>
  );
}
