import { Routes, Route } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarClock,
  Clock,
  Users as UsersIcon,
  Settings,
  Stethoscope,
  Building2,
  ShieldCheck,
  Star,
  KeyRound,
} from "lucide-react";

import { DashboardLayout } from "./components/layout/DashboardLayout";
import { ProtectedRoute } from "./routes/ProtectedRoute";

import Login from "./pages/Login";
import Register from "./pages/Register";
import DoctorDashboard from "./pages/doctor/DoctorDashboard";
import DoctorAppointments from "./pages/doctor/DoctorAppointments";
import DoctorSchedule from "./pages/doctor/DoctorSchedule";
import DoctorPatients from "./pages/doctor/DoctorPatients";
import DoctorProfileSettings from "./pages/doctor/DoctorProfileSettings";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminDoctors from "./pages/admin/AdminDoctors";
import AdminSpecialties from "./pages/admin/AdminSpecialties";
import AdminWilayas from "./pages/admin/AdminWilayas";
import AdminReviews from "./pages/admin/AdminReviews";
import AccountSettings from "./pages/AccountSettings";

const doctorNav = [
  { to: "/", label: "الرئيسية", icon: LayoutDashboard, end: true },
  { to: "/appointments", label: "المواعيد", icon: CalendarClock },
  { to: "/schedule", label: "أوقات العمل", icon: Clock },
  { to: "/patients", label: "مرضاي", icon: UsersIcon },
  { to: "/profile", label: "ملفي المهني", icon: Settings },
  { to: "/account", label: "إعدادات الحساب", icon: KeyRound },
];

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

      <Route element={<ProtectedRoute allow={["DOCTOR"]} />}>
        <Route element={<DashboardLayout title="لوحة الطبيب" items={doctorNav} />}>
          <Route path="/" element={<DoctorDashboard />} />
          <Route path="/appointments" element={<DoctorAppointments />} />
          <Route path="/schedule" element={<DoctorSchedule />} />
          <Route path="/patients" element={<DoctorPatients />} />
          <Route path="/profile" element={<DoctorProfileSettings />} />
          <Route path="/account" element={<AccountSettings />} />
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
