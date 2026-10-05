import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { Spinner } from "./components/ui/States";
import { PageLoadBoundary } from "./components/PageLoadBoundary";
import { canManageClinic, canOpenClinic } from "./lib/clinicAccess";
import {
  LayoutDashboard,
  CalendarClock,
  Users as UsersIcon,
  Settings,
  Stethoscope,
  Building2,
  ShieldCheck,
  Star,
  KeyRound,
  MessageSquare,
  UserX,
  Gift,
} from "lucide-react";

import { DashboardLayout } from "./components/layout/DashboardLayout";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { useAuth } from "./context/AuthContext";

const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ApplyDoctor = lazy(() => import("./pages/ApplyDoctor"));
const AssistantAcceptInvite = lazy(() => import("./pages/AssistantAcceptInvite"));
const DoctorHome = lazy(() => import("./pages/doctor/DoctorHome"));
const AssistantBoard = lazy(() => import("./pages/doctor/AssistantBoard"));
const DoctorOverview = lazy(() => import("./pages/doctor/DoctorOverview"));
const DoctorSettingsHub = lazy(() => import("./pages/doctor/DoctorSettingsHub"));
const DoctorAppointments = lazy(() => import("./pages/doctor/DoctorAppointments"));
const DoctorSchedule = lazy(() => import("./pages/doctor/DoctorSchedule"));
const DoctorPatients = lazy(() => import("./pages/doctor/DoctorPatients"));
const DoctorReviews = lazy(() => import("./pages/doctor/DoctorReviews"));
const DoctorProfileSettings = lazy(() => import("./pages/doctor/DoctorProfileSettings"));
const AssistantManagement = lazy(() => import("./pages/doctor/AssistantManagement"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminPatientBlocks = lazy(() => import("./pages/admin/AdminPatientBlocks"));
const AdminDoctors = lazy(() => import("./pages/admin/AdminDoctors"));
const AdminSpecialties = lazy(() => import("./pages/admin/AdminSpecialties"));
const AdminWilayas = lazy(() => import("./pages/admin/AdminWilayas"));
const AdminReviews = lazy(() => import("./pages/admin/AdminReviews"));
const AdminAppointments = lazy(() => import("./pages/admin/AdminAppointments"));
const AdminMessages = lazy(() => import("./pages/admin/AdminMessages"));
const DoctorMessages = lazy(() => import("./pages/doctor/DoctorMessages"));
const DoctorTreatmentPlans = lazy(() => import("./pages/doctor/DoctorTreatmentPlans"));
const AdminReferrals = lazy(() => import("./pages/admin/AdminReferrals"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const ClinicRegister = lazy(() => import("./pages/clinic/ClinicRegister"));
const ClinicManagement = lazy(() => import("./pages/clinic/ClinicManagement"));
const ClinicDoctorInvite = lazy(() => import("./pages/clinic/ClinicDoctorInvite"));
const AdminClinics = lazy(() => import("./pages/admin/AdminClinics"));
import { useAdminUnread, useDoctorUnread, useUnreadToast } from "./hooks/useMessaging";

// الروابط المشتركة بين الطبيب والمساعد (الصفحات التي يُسمح للمساعد برؤيتها فقط).
const sharedNav = [
  { to: "/", label: "الطابور", icon: LayoutDashboard, end: true },
  { to: "/appointments", label: "المواعيد", icon: CalendarClock },
];

// قائمة الطبيب: أربعة عناصر فقط. بقية الصفحات (أوقات العمل، التقييمات، المساعدون، الملف المهني،
// الحساب، المراسلة، العيادة، خطط العلاج، نظرة عامة) تبقى متاحة بنقرة من «الإعدادات» (/settings).
const doctorMainNav = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard, end: true },
  { to: "/appointments", label: "المواعيد", icon: CalendarClock },
  { to: "/patients", label: "المرضى", icon: UsersIcon },
  {
    to: "/settings",
    label: "الإعدادات",
    icon: Settings,
    // الصفحات التابعة لـ«الإعدادات» تُبقي العنصر مضيئًا (القائمة تبقى أربعة عناصر).
    activeFor: ["/overview", "/schedule", "/reviews", "/assistants", "/profile", "/account", "/messages", "/treatment-plans"],
  },
];

/** الرئيسية: لوحة التحكم الجديدة للطبيب؛ المساعد يبقى على الرئيسية الحالية حتى المرحلة ج. */
function HomeRoute() {
  const { user } = useAuth();
  return user?.role === "ASSISTANT" ? <AssistantBoard /> : <DoctorHome />;
}

function AppointmentsRoute() {
  const { user } = useAuth();
  return user?.role === "ASSISTANT" ? <AssistantBoard appointmentsView /> : <DoctorAppointments />;
}

/**
 * الشريط الجانبي واحد لكل من الطبيب والمساعد، لكن العناصر والعنوان يختلفان حسب الدور —
 * المساعد يرى فقط الرئيسية/الطابور/المواعيد (sharedNav)، ولا يظهر له أي رابط لصفحة طبيب
 * فقط حتى لو كانت محميّة أصلًا على مستوى المسار (ProtectedRoute) والخادم معًا.
 */
function DoctorAreaLayout() {
  const { user } = useAuth();
  const isAssistant = user?.role === "ASSISTANT";
  useEffect(() => {
    document.title = isAssistant ? "مادبوك — لوحة المساعد" : "مادبوك — لوحة تحكم الطبيب";
  }, [isAssistant]);
  // المراسلة للطبيب فقط: لا نستعلم ولا نُظهر الرابط للمساعد (والخادم يرفضه 403 أيضًا).
  const unread = useDoctorUnread(!isAssistant && !!user);
  useUnreadToast(unread.data?.unread, () => "رسالة جديدة من الإدارة", "/messages?focus=unread");
  const items = isAssistant
    ? sharedNav
    : doctorMainNav.map((i) => (i.to === "/settings" ? { ...i, badge: unread.data?.unread } : i));

  return (
    <DashboardLayout
      title={isAssistant ? "لوحة المساعد" : "لوحة الطبيب"}
      subtitle={isAssistant ? "إدارة المواعيد والطابور لأطباء العيادة" : undefined}
      items={items}
      dailyNavigation
      settingsStart={isAssistant ? undefined : doctorMainNav.length}
      clinicMode={canManageClinic(user)}
    />
  );
}

const adminNav = [
  { to: "/admin/clinics", label: "العيادات", icon: Building2 },
  { to: "/admin", label: "الرئيسية", icon: LayoutDashboard, end: true },
  { to: "/admin/appointments", label: "المواعيد", icon: CalendarClock },
  { to: "/admin/messages", label: "الرسائل", icon: MessageSquare },
  { to: "/admin/users", label: "المستخدمون", icon: UsersIcon },
  { to: "/admin/patient-blocks", label: "المرضى المحظورون", icon: UserX },
  { to: "/admin/referrals", label: "إحالات الأطباء", icon: Gift },
  { to: "/admin/doctors", label: "الأطباء", icon: Stethoscope },
  { to: "/admin/specialties", label: "التخصصات", icon: ShieldCheck },
  { to: "/admin/wilayas", label: "الولايات", icon: Building2 },
  { to: "/admin/reviews", label: "التقييمات", icon: Star },
  { to: "/admin/account", label: "إعدادات الحساب", icon: KeyRound },
];

function AdminAreaLayout() {
  const unread = useAdminUnread();
  useUnreadToast(unread.data?.unread, () => `رسالة جديدة من ${unread.data?.latest ? `د. ${unread.data.latest.doctorName}` : "طبيب"}`);
  const items = adminNav.map((i) => (i.to === "/admin/messages" ? { ...i, badge: unread.data?.unread } : i));
  return <DashboardLayout title="لوحة الإدارة" items={items} />;
}

export default function App() {
  return (
    <PageLoadBoundary>
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/register/clinic" element={<ClinicRegister />} />
      {/* حساب مريض يضيف ملف طبيب إلى حسابه نفسه */}
      <Route element={<ProtectedRoute allow={["PATIENT"]} />}>
        <Route path="/apply" element={<ApplyDoctor />} />
      </Route>
      <Route path="/clinic/doctor/accept/:token" element={<ClinicDoctorInvite />} />
      <Route path="/assistant/accept/:token" element={<AssistantAcceptInvite />} />
      <Route element={<ProtectedRoute allow={["CLINIC_OWNER", "DOCTOR"]} />}>
        <Route element={<ClinicAccessRoute />}>
        <Route element={<DashboardLayout title="إدارة العيادة" items={[
          { to: "/clinic", label: "العيادة والأطباء", icon: Building2, end: true },
          { to: "/clinic/account", label: "إعدادات الحساب", icon: KeyRound },
          ...(useClinicDoctorNav()),
        ]} />}>
          <Route path="/clinic" element={<ClinicManagement />} />
          <Route path="/clinic/account" element={<AccountSettings />} />
        </Route>
        </Route>
      </Route>

      {/* الطبيب والمساعد معًا: الدخول مسموح، ثم داخل نفس التخطيط تُقيَّد صفحات الطبيب فقط
          بحارس إضافي (ProtectedRoute allow=["DOCTOR"]) متداخل — أي محاولة من المساعد لفتح
          رابط صفحة طبيب مباشرة (مثل /patients) تُعاد فورًا إلى "/"، تمامًا كما لو كان دوره
          غير مسموح به من الأساس؛ الحماية الفعلية مع ذلك مصدرها الخادم (كل نقطة API خاصة
          بالطبيب ترفض المساعد بـ403 بغض النظر عمّا تعرضه هذه الواجهة). */}
      <Route element={<ProtectedRoute allow={["DOCTOR", "ASSISTANT"]} />}>
        <Route element={<DoctorAreaLayout />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/appointments" element={<AppointmentsRoute />} />

          <Route element={<ProtectedRoute allow={["DOCTOR"]} />}>
            <Route path="/overview" element={<DoctorOverview />} />
            <Route path="/settings" element={<DoctorSettingsHub />} />
            <Route path="/messages" element={<DoctorMessages />} />
            <Route path="/schedule" element={<DoctorSchedule />} />
            <Route path="/patients" element={<DoctorPatients />} />
            <Route path="/treatment-plans" element={<DoctorTreatmentPlans />} />
            <Route path="/reviews" element={<DoctorReviews />} />
            <Route path="/assistants" element={<AssistantManagementRoute />} />
            <Route path="/profile" element={<DoctorProfileSettings />} />
            <Route path="/account" element={<AccountSettings />} />
          </Route>
        </Route>
      </Route>

      <Route element={<ProtectedRoute allow={["ADMIN"]} />}>
        <Route element={<AdminAreaLayout />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/clinics" element={<AdminClinics />} />
          <Route path="/admin/appointments" element={<AdminAppointments />} />
          <Route path="/admin/messages" element={<AdminMessages />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/patient-blocks" element={<AdminPatientBlocks />} />
          <Route path="/admin/referrals" element={<AdminReferrals />} />
          <Route path="/admin/doctors" element={<AdminDoctors />} />
          <Route path="/admin/specialties" element={<AdminSpecialties />} />
          <Route path="/admin/wilayas" element={<AdminWilayas />} />
          <Route path="/admin/reviews" element={<AdminReviews />} />
          <Route path="/admin/account" element={<AccountSettings />} />
        </Route>
      </Route>

      <Route path="*" element={<Login />} />
    </Routes>
    </Suspense>
    </PageLoadBoundary>
  );
}

function useClinicDoctorNav() {
  const { user } = useAuth();
  return user?.role === "DOCTOR" ? [{ to: "/", label: "لوحتي كطبيب", icon: Stethoscope, end: true }] : [];
}

function ClinicAccessRoute() {
  const { user } = useAuth();
  return canOpenClinic(user) ? <Outlet /> : <Navigate to="/" replace />;
}

function AssistantManagementRoute() {
  const { user } = useAuth();
  return user?.doctor?.clinic ? <Navigate to={canManageClinic(user) ? "/clinic" : "/"} replace /> : <AssistantManagement />;
}
