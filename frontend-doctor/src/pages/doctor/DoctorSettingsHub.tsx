import { Link } from "react-router-dom";
import { BarChart3, Building2, ClipboardList, Clock, KeyRound, LucideIcon, MessageSquare, Settings, Star, UserCog } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useDoctorUnread } from "../../hooks/useMessaging";
import { isDentalSpecialty } from "../../lib/features";
import { canManageClinic, canOpenClinic } from "../../lib/clinicAccess";

interface HubItem {
  to: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  badge?: number;
}

/**
 * مركز الإعدادات للطبيب: يجمع الصفحات التي خرجت من القائمة الجانبية (لا حذف لأي صفحة).
 * للطبيب وحده — المسار محمي بـ ProtectedRoute allow=["DOCTOR"] والمساعد لا يصل إليه.
 */
export default function DoctorSettingsHub() {
  const { user } = useAuth();
  const unread = useDoctorUnread(Boolean(user));
  // نص بطاقة العيادة حسب الحالة الفعلية: مدير عيادة / طبيب ضمن عيادة / بلا عيادة (الصفحة نفسها لم تتغيّر).
  const clinic = user?.doctor?.clinic ?? null;
  const clinicHint = !clinic
    ? "إنشاء عيادة (يتطلب موافقة الإدارة)"
    : canManageClinic(user)
    ? `إدارة «${clinic.nameAr}» وأطبائها ومساعديها`
    : `أنت ضمن «${clinic.nameAr}»؛ إدارتها لمديرها`;

  const items: HubItem[] = [
    { to: "/overview", title: "نظرة عامة", hint: "الإحصاءات، الدخل والمستحقات، رمز الحجز QR، ودعوة زميل", icon: BarChart3 },
    { to: "/schedule", title: "أوقات العمل", hint: "أيام وساعات الدوام والعطل", icon: Clock },
    { to: "/reviews", title: "التقييمات", hint: "آراء المرضى بعد المواعيد", icon: Star },
    ...(!clinic ? [{ to: "/assistants", title: "المساعدون", hint: "دعوة المساعدين وإدارة حساباتهم", icon: UserCog }] : []),
    { to: "/profile", title: "الملف المهني", hint: "بياناتك التي تظهر للمرضى", icon: Settings },
    { to: "/account", title: "إعدادات الحساب", hint: "البريد وكلمة المرور والجلسات", icon: KeyRound },
    {
      to: unread.data?.unread ? "/messages?focus=unread" : "/messages",
      title: "مراسلة الإدارة",
      hint: "تواصل مع إدارة مادبوك",
      icon: MessageSquare,
      badge: unread.data?.unread,
    },
    ...(canOpenClinic(user) ? [{ to: "/clinic", title: canManageClinic(user) ? "إدارة العيادة" : "إنشاء عيادة", hint: clinicHint, icon: Building2 }] : []),
    ...(isDentalSpecialty(user?.doctor?.specialty)
      ? [{ to: "/treatment-plans", title: "خطط العلاج", hint: "خطط علاج الأسنان والمتابعات", icon: ClipboardList } as HubItem]
      : []),
  ];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-900">الإعدادات</h1>
        <p className="mt-1 text-sm text-slate-500">كل ما يخص حسابك وعيادتك في مكان واحد</p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="card flex h-full items-start gap-3 p-4 transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
                <item.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-bold text-slate-900">
                  {item.title}
                  {item.badge ? (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white" aria-label={`${item.badge} غير مقروءة`}>
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-sm text-slate-500">{item.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
