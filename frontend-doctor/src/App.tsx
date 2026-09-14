import { Routes, Route } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarClock,
  ListOrdered,
  Clock,
  Users as UsersIcon,
  Settings,
  Stethoscope,
  Building2,
  ShieldCheck,
  Star,
  KeyRound,
  UserCog,
} from "lucide-react";

import { DashboardLayout } from "./components/layout/DashboardLayout";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { useAuth } from "./context/AuthContext";

import Login from "./pages/Login";
import Register from "./pages/Register";
import AssistantAcceptInvite from "./pages/AssistantAcceptInvite";
import DoctorDashboard from "./pages/doctor/DoctorDashboard";
import DoctorAppointments from "./pages/doctor/DoctorAppointments";
import DoctorQueue from "./pages/doctor/DoctorQueue";
import DoctorSchedule from "./pages/doctor/DoctorSchedule";
import DoctorPatients from "./pages/doctor/DoctorPatients";
import DoctorProfileSettings from "./pages/doctor/DoctorProfileSettings";
import AssistantManagement from "./pages/doctor/AssistantManagement";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminDoctors from "./pages/admin/AdminDoctors";
import AdminSpecialties from "./pages/admin/AdminSpecialties";
import AdminWilayas from "./pages/admin/AdminWilayas";
import AdminReviews from "./pages/admin/AdminReviews";
import AccountSettings from "./pages/AccountSettings";

// الروابط المشتركة بين الطبيب والمساعد (الصفحات التي يُسمح للمساعد برؤيتها فقط).
const sharedNav = [
  { to: "/", label: "الرئيسية", icon: LayoutDashboard, end: true },
  { to: "/queue", label: "طابور اليوم", icon: ListOrdered },
  { to: "/appointments", label: "المواعيد", icon: CalendarClock },
];

// روابط إضافية للطبيب وحده — لا تظهر أبدًا في قائمة المساعد.
const doctorOnlyNav = [
  { to: "/schedule", label: "أوقات العمل", icon: Clock },
  { to: "/patients", label: "مرضاي", icon: UsersIcon },
  { to: "/assistants", label: "المساعدون", icon: UserCog },
  { to: "/profile", label: "ملفي المهني", icon: Settings },
  { to: "/account", label: "إعدادات الحساب", icon: KeyRound },
];

const doctorNav = [...sharedNav, ...doctorOnlyNav];

/**
 * الشريط الجانبي واحد لكل من الطبيب والمساعد، لكن العناصر والعنوان يختلفان حسب الدور —
 * المساعد يرى فقط الرئيسية/الطابور/المواعيد (sharedNav)، ولا يظهر له أي رابط لصفحة طبيب
 * فقط حتى لو كانت محميّة أصلًا على مستوى المسار (ProtectedRoute) والخادم معًا.
 */
function DoctorAreaLayout() {
  const { user } = useAuth();
  const isAssistant = user?.role === "ASSISTANT";
  const doctorName = user?.assistant?.doctor ? `${user.assistant.doctor.firstName} ${user.assistant.doctor.lastName}` : "";

  return (
    <DashboardLayout
      title={isAssistant ? "لوحة المساعد" : "لوحة الطبيب"}
      subtitle={isAssistant && doctorName ? `مساعد لدى د. ${doctorName}` : undefined}
      items={isAssistant ? sharedNav : doctorNav}
    />
  );
}

const adminNav = [
  { to: "/admin", label: "الرئيسية", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "المستخدمون", icon: UsersIcon },
  { to: "/admin/doctors", label: "الأطباء", icon: Stethoscope },
  { to: "/admin/specialties", label: "التخصصات", icon: ShieldCheck },
  { to: "/admin/wilayas", label: "الولايات", icon: Building2 },
  { to: "/admin/reviews", label: "التقييمات", icon: Star },
  { to: "/admin/account", label: "إعدادات الحساب", icon: KeyRound },
];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/assistant/accept/:token" element={<AssistantAcceptInvite />} />

      {/* الطبيب والمساعد معًا: الدخول مسموح، ثم داخل نفس التخطيط تُقيَّد صفحات الطبيب فقط
          بحارس إضافي (ProtectedRoute allow=["DOCTOR"]) متداخل — أي محاولة من المساعد لفتح
          رابط صفحة طبيب مباشرة (مثل /patients) تُعاد فورًا إلى "/"، تمامًا كما لو كان دوره
          غير مسموح به من الأساس؛ الحماية الفعلية مع ذلك مصدرها الخادم (كل نقطة API خاصة
          بالطبيب ترفض المساعد بـ403 بغض النظر عمّا تعرضه هذه الواجهة). */}
      <Route element={<ProtectedRoute allow={["DOCTOR", "ASSISTANT"]} />}>
        <Route element={<DoctorAreaLayout />}>
          <Route path="/" element={<DoctorDashboard />} />
          <Route path="/queue" element={<DoctorQueue />} />
          <Route path="/appointments" element={<DoctorAppointments />} />

          <Route element={<ProtectedRoute allow={["DOCTOR"]} />}>
            <Route path="/schedule" element={<DoctorSchedule />} />
            <Route path="/patients" element={<DoctorPatients />} />
            <Route path="/assistants" element={<AssistantManagement />} />
            <Route path="/profile" element={<DoctorProfileSettings />} />
            <Route path="/account" element={<AccountSettings />} />
          </Route>
        </Route>
      </Route>

      <Route element={<ProtectedRoute allow={["ADMIN"]} />}>
        <Route element={<DashboardLayout title="لوحة الإدارة" items={adminNav} />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/doctors" element={<AdminDoctors />} />
          <Route path="/admin/specialties" element={<AdminSpecialties />} />
          <Route path="/admin/wilayas" element={<AdminWilayas />} />
          <Route path="/admin/reviews" element={<AdminReviews />} />
          <Route path="/admin/account" element={<AccountSettings />} />
        </Route>
      </Route>

      <Route path="*" element={<Login />} />
    </Routes>
  );
}
