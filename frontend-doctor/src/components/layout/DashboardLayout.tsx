import { UrgencyRequests } from "../UrgencyRequests";
import { GuestBooking } from "../GuestBooking";
import { GuestClaimReview } from "../GuestClaimReview";
import { ShiftControl } from "../ShiftControl";
import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale";
import { ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Building2, ChevronLeft, LucideIcon, LogOut, Menu, Stethoscope, X } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../../context/AuthContext";
import { Logo } from "../ui/Logo";
import { SwitchToPatientButton } from "../ProfilesCard";
import { accountDisplayName, initialsOf, readSidebarCollapsed, roleLabel, splitNavItems, writeSidebarCollapsed } from "../../lib/sidebar";

export interface DashboardNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** عدّاد صغير بجانب الرابط (مثل الرسائل غير المقروءة). لا يظهر إن كان 0 أو غير معرّف. */
  badge?: number;
  /** مسارات تابعة تُبقي هذا العنصر مضيئًا عند زيارتها (مثل صفحات «الإعدادات»). */
  activeFor?: string[];
  group?: string;
  /** يُعرض في أسفل القائمة الجانبية (الإعدادات) بدل قائمة الأقسام. */
  footer?: boolean;
}

/**
 * تخطيط لوحات الطبيب/المساعد/الإدارة.
 * - الحاسوب: لوحة زجاجية عائمة قابلة للطي (264px ↔ 76px)، يُحفظ اختيار الطي في localStorage.
 * - الهاتف: قائمة جانبية منزلقة مع طبقة مظللة، تُغلق بالنقر خارجها أو باختيار صفحة أو بـEscape.
 * الاتجاه منطقي (start/end): يمين الشاشة في العربية (dir=rtl) ويُعكس تلقائيًا في dir=ltr.
 * التعديل بصري فقط: نفس الروابط والصلاحيات (تأتي من App.tsx حسب الدور) دون طلبات أو مؤقتات جديدة.
 */
export function DashboardLayout({
  title,
  contentClassName,
  subtitle,
  items,
  dailyNavigation = false,
  settingsStart,
  clinicMode = false,
}: {
  title: string;
  contentClassName?: string;
  /** شارة اختيارية تحت العنوان (مثل "مساعد لدى د. ..."). لا تُعرض إن لم تُمرَّر. */
  subtitle?: string;
  items: DashboardNavItem[];
  dailyNavigation?: boolean;
  settingsStart?: number;
  clinicMode?: boolean;
}) {
  useLanguage();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isItemActive = (item: DashboardNavItem, isActive: boolean) =>
    isActive || (item.activeFor ?? []).some((p) => pathname === p || pathname.startsWith(p + "/"));

  const [collapsed, setCollapsed] = useState<boolean>(() => readSidebarCollapsed());
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      writeSidebarCollapsed(!v);
      return !v;
    });
  }, []);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const openMobileMenu = () => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setMobileMenuOpen(true);
  };
  const closeMobileMenu = useCallback((restoreFocus = true) => {
    setMobileMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => returnFocus.current?.focus());
  }, []);

  // الدرج المغلق خارج شجرة التركيز ولا تقرؤه قارئات الشاشة.
  useEffect(() => {
    const el = drawerRef.current;
    if (el) el.inert = !mobileMenuOpen;
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const drawer = drawerRef.current;
    const focusables = () =>
      Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
        closeMobileMenu();
        return;
      }
      if (event.key !== "Tab") return;
      // حبس التركيز داخل القائمة المفتوحة.
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileMenuOpen, closeMobileMenu]);

  // إغلاق القائمة عند الانتقال لصفحة أخرى (بما فيها أزرار الرجوع في المتصفح).
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const { main, footer } = splitNavItems(items);
  const name = accountDisplayName(user).replace(/^د\.\s*/, t("د. "));
  const account = { name, initials: initialsOf(name.replace(/^د\.\s*/, "")), role: t(roleLabel(user?.role)) };

  const renderNav = (compact: boolean, onNavigate?: () => void) => (
    <>
      {!compact && !main[0]?.group && <p className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.18em] text-white/75">{t("القائمة")}</p>}
      <ul className="space-y-1" role="list">
        {main.map((item, index) => (
          <li key={item.to}>
            {item.group && item.group !== main[index - 1]?.group && (
              compact
                ? <div className="my-3 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" aria-hidden />
                : <><div className="my-3 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" aria-hidden /><p className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.18em] text-white/75">{t(item.group ?? "")}</p></>
            )}
            {index === settingsStart && settingsStart < main.length && (
              compact
                ? <div className="my-3 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" aria-hidden />
                : <><div className="my-3 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" aria-hidden /><p className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.18em] text-white/75">{t("الإدارة والإعدادات")}</p></>
            )}
            <SidebarLink item={item} compact={compact} active={(a) => isItemActive(item, a)} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </>
  );

  const renderFooter = (compact: boolean, onNavigate?: () => void) => (
    <div className="space-y-1">
      <div className="my-3 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" aria-hidden />
      {!compact && <p className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.18em] text-white/75">{t("عام")}</p>}
      {footer.map((item) => (
        <SidebarLink key={item.to} item={item} compact={compact} active={(a) => isItemActive(item, a)} onNavigate={onNavigate} />
      ))}
      <div className="group relative">
        <SwitchToPatientButton
          compact={compact}
          onDone={onNavigate}
          className={clsx(itemBase, itemIdle, compact && "justify-center px-0")}
        />
      </div>
      <div className="group relative">
        <button
          type="button"
          onClick={handleLogout}
          aria-label={compact ? t("تسجيل الخروج") : undefined}
          className={clsx(itemBase, "text-rose-100 hover:bg-white/10 hover:text-white", compact && "justify-center px-0")}
        >
          <span className={iconChip}><LogOut className="h-4 w-4" aria-hidden /></span>
          {!compact && <span className="truncate">{t("تسجيل الخروج")}</span>}
        </button>
        {compact && <Tip>{t("تسجيل الخروج")}</Tip>}
      </div>
    </div>
  );

  const renderClinicSwitch = (compact: boolean, onNavigate?: () => void) =>
    clinicMode && (
      <div className={clsx("mt-3 flex gap-1.5 rounded-2xl border border-white/10 bg-white/[0.06] p-1.5 text-sm", compact && "flex-col")}>
        {[
          { to: "/", label: t("وضع الطبيب"), icon: Stethoscope, end: true },
          { to: "/clinic", label: t("إدارة العيادة"), icon: Building2, end: false },
        ].map((m) => (
          <div key={m.to} className="group relative flex-1">
            <NavLink
              to={m.to}
              end={m.end}
              onClick={onNavigate}
              aria-label={compact ? m.label : undefined}
              className={({ isActive }) =>
                clsx(
                  "flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none",
                  isActive ? "bg-primary-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                )
              }
            >
              <m.icon className="h-4 w-4 shrink-0" aria-hidden />
              {!compact && <span className="truncate">{m.label}</span>}
            </NavLink>
            {compact && <Tip>{m.label}</Tip>}
          </div>
        ))}
      </div>
    );

  const accountCard = (compact: boolean) => (
    <div
      className={clsx(
        "mt-4 flex items-center gap-3 rounded-2xl",
        compact ? "justify-center" : "border border-white/10 bg-white/[0.07] p-2.5"
      )}
      title={compact ? `${account.name} — ${account.role}` : undefined}
    >
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-sky-600 text-sm font-bold text-white ring-2 ring-white/30"
      >
        {account.initials}
      </span>
      <div className={clsx("min-w-0", compact && "sr-only")}>
        <p className="truncate text-sm font-bold text-white">{account.name}</p>
        <p className="truncate text-xs text-white/80">{subtitle ?? `${account.role} · ${title}`}</p>
      </div>
    </div>
  );

  return (
    <div className="app-glass-bg flex min-h-screen">
      {/* ===== الحاسوب: لوحة زجاجية عائمة ===== */}
      <aside
        aria-label={t("القائمة الجانبية")}
        className={clsx(
          "glass-sidebar sticky top-3 z-30 m-3 hidden h-[calc(100vh-1.5rem)] shrink-0 flex-col rounded-3xl text-slate-100 [text-shadow:0_1px_2px_rgba(2,6,23,0.35)] md:flex",
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "w-[76px]" : "w-[264px]"
        )}
      >
        <div className={clsx("relative flex h-16 shrink-0 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
          <Logo className="h-9 w-9 shrink-0" />
          {!collapsed && <span className="truncate text-lg font-extrabold tracking-tight text-white">MedBook</span>}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("توسيع القائمة الجانبية") : t("طي القائمة الجانبية")}
            title={collapsed ? t("توسيع القائمة") : t("طي القائمة")}
            className="absolute -end-3.5 top-5 flex h-7 w-7 items-center justify-center rounded-full border border-white/30 bg-[#0f3d5c] text-white shadow-lg transition-colors duration-200 hover:bg-primary-500 motion-reduce:transition-none"
          >
            {/* السهم يشير لاتجاه الحركة: نحو حافة الشاشة عند الطي، ويُعكس في RTL. */}
            <ChevronLeft
              className={clsx("h-4 w-4 transition-transform duration-200 motion-reduce:transition-none rtl:-scale-x-100", collapsed && "rotate-180")}
              aria-hidden
            />
          </button>
        </div>

        <div className={clsx("px-3", collapsed && "px-2")}>
          {accountCard(collapsed)}
          {renderClinicSwitch(collapsed)}
        </div>

        <nav aria-label={t("أقسام اللوحة")} className={clsx("mt-3 flex-1 px-3 pb-2", collapsed ? "overflow-visible px-2" : "overflow-y-auto")}>
          {renderNav(collapsed)}
        </nav>

        <div className={clsx("px-3 pb-3", collapsed && "px-2")}>{renderFooter(collapsed)}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ===== الهاتف: شريط علوي + قائمة منزلقة ===== */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/70 bg-white/70 px-4 backdrop-blur-md md:hidden">
          <div className="flex min-w-0 items-center gap-2 text-primary-700">
            <Logo className="h-8 w-8 shrink-0" />
            <span className="truncate text-lg font-extrabold">MedBook</span>
          </div>
          <button
            type="button"
            aria-controls={menuId}
            aria-expanded={mobileMenuOpen}
            onClick={() => (mobileMenuOpen ? closeMobileMenu() : openMobileMenu())}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100"
            aria-label={mobileMenuOpen ? t("إغلاق القائمة") : t("فتح القائمة")}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div
          aria-hidden
          onClick={() => closeMobileMenu()}
          className={clsx(
            "fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 motion-reduce:transition-none md:hidden",
            mobileMenuOpen ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        />
        <div
          ref={drawerRef}
          id={menuId}
          role="dialog"
          aria-modal="true"
          aria-label={t("القائمة")}
          className={clsx(
            "glass-sidebar fixed inset-y-2 start-2 z-50 flex w-[min(288px,calc(100vw-3rem))] flex-col rounded-3xl text-slate-100 [text-shadow:0_1px_2px_rgba(2,6,23,0.35)] md:hidden",
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
            mobileMenuOpen ? "translate-x-0" : "ltr:-translate-x-[110%] rtl:translate-x-[110%]"
          )}
        >
          <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <Logo className="h-9 w-9 shrink-0" />
              <span className="truncate text-lg font-extrabold text-white">MedBook</span>
            </div>
            <button
              type="button"
              onClick={() => closeMobileMenu()}
              aria-label={t("إغلاق القائمة")}
              className="flex h-11 w-11 items-center justify-center rounded-full text-slate-200 hover:bg-white/10"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <div className="px-3">
            {accountCard(false)}
            {renderClinicSwitch(false, () => closeMobileMenu(false))}
          </div>
          <nav aria-label={t("أقسام اللوحة")} className="mt-3 flex-1 overflow-y-auto px-3 pb-2">
            {renderNav(false, () => closeMobileMenu(false))}
          </nav>
          <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{renderFooter(false, () => closeMobileMenu(false))}</div>
        </div>

        {/* min-w-0 + overflow-x-hidden: خط دفاع أخير حتى لا يُخرج أي عنصر عريض الصفحة عن عرض الشاشة. */}
        <main className={clsx("min-w-0 flex-1 overflow-x-hidden p-4 md:p-8 md:ps-5", contentClassName, dailyNavigation && "pb-24 md:pb-8")}>
          <ShiftControl />
          {user?.role === "DOCTOR" && <GuestBooking />}
          {(user?.role === "DOCTOR" || user?.role === "ASSISTANT") && <GuestClaimReview />}
          {user?.role === "DOCTOR" && <UrgencyRequests />}
          <Outlet />
        </main>
        {dailyNavigation && (
          <nav aria-label={t("التنقل اليومي")} className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
            {items.slice(0, settingsStart ?? 2).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx("relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[11px]", isItemActive(item, isActive) ? "bg-primary-50 text-primary-700" : "text-slate-600")
                }
              >
                <item.icon className="h-5 w-5" aria-hidden />
                <span className="truncate">{t(item.label ?? "")}</span>
                {item.badge ? <span className="absolute top-1 rounded-full bg-red-600 px-1 text-[10px] text-white">{t(item.badge ?? "")}</span> : null}
              </NavLink>
            ))}
            <button
              type="button"
              aria-controls={menuId}
              aria-expanded={mobileMenuOpen}
              onClick={() => (mobileMenuOpen ? closeMobileMenu() : openMobileMenu())}
              className="flex flex-1 flex-col items-center gap-1 py-3 text-[11px] text-slate-600"
            >
              <Menu className="h-5 w-5" aria-hidden />{t("المزيد ")}</button>
          </nav>
        )}
      </div>
    </div>
  );
}

const itemBase =
  "relative flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors duration-200 motion-reduce:transition-none";
const itemIdle = "text-white/95 hover:bg-white/[0.08] hover:text-white";
/** الأيقونة داخل دائرة صغيرة شفافة كما في المرجع المرئي. */
const iconChip = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/10";

/** تلميح يظهر عند المرور أو التركيز بلوحة المفاتيح (في الوضع المطوي فقط). يظهر في جهة المحتوى. */
function Tip({ children }: { children: ReactNode }) {
  useLanguage();
  return (
    <span
      role="presentation"
      className="pointer-events-none absolute start-full top-1/2 z-50 ms-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
    >
      {children}
    </span>
  );
}

function SidebarLink({
  item,
  compact,
  active,
  onNavigate,
}: {
  item: DashboardNavItem;
  compact: boolean;
  active: (isActive: boolean) => boolean;
  onNavigate?: () => void;
}) {
  useLanguage();
  const badge = item.badge ? (item.badge > 99 ? "99+" : String(item.badge)) : null;
  return (
    <div className="group relative">
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        aria-label={compact ? (badge ? t("{0} ({1} غير مقروءة)", { "0": item.label, "1": badge }) : item.label) : undefined}
        className={({ isActive }) =>
          clsx(
            itemBase,
            compact && "justify-center px-0",
            active(isActive)
              ? clsx("text-white bg-gradient-to-l from-primary-500 to-primary-600 shadow-[0_8px_24px_-10px_rgba(63,185,172,0.9)]", compact ? "-mx-2 !w-[calc(100%+1rem)] rounded-none" : "-mx-3 !w-[calc(100%+1.5rem)] rounded-none px-6")
              : itemIdle
          )
        }
      >
        <span className={clsx(iconChip, "relative")}>
          <item.icon className="h-4 w-4" aria-hidden />
          {compact && badge && (
            <span className="absolute -end-2.5 -top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#0f3d5c]">
              {badge}
            </span>
          )}
        </span>
        {!compact && <span className="min-w-0 flex-1 truncate">{t(item.label ?? "")}</span>}
        {!compact && badge && (
          <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">
            {badge}
          </span>
        )}
      </NavLink>
      {compact && <Tip>{t(item.label ?? "")}</Tip>}
    </div>
  );
}


