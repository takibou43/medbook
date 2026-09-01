import { Routes, Route } from "react-router-dom";
import { LayoutDashboard, CalendarDays, UserRound, Bell, CalendarClock, Clock, Users as UsersIcon, Settings } from "lucide-react";
import { Users, Stethoscope, ListTree, MapPin, Star } from "lucide-react";

import { PublicLayout } from "./components/layout/Layout";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { ProtectedRoute } from "./routes/ProtectedRoute";

import Home from "./pages/Home";
import Doctors from "./pages/Doctors";
import DoctorProfile from "./pages/DoctorProfile";
import Specialties from "./pages/Specialties";
import HowItWorks from "./pages/HowItWorks";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";

import PatientDashboard from "./pages/patient/PatientDashboard";
import PatientAppointments from "./pages/patient/PatientAppointments";
import PatientProfile from "./pages/patient/PatientProfile";
import PatientNotifications from "./pages/patient/PatientNotifications";

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

const patientNav = [
  { to: "/patient", label: "الرئيسية", icon: LayoutDashboard, end: true },
  { to: "/patient/appointments", label: "مواعيدي", icon: CalendarDays },
  { to: "/patient/notifications", label: "الإشعارات", icon: Bell },
  { to: "/patient/profile", label: "الملف الشخصي", icon: UserRound },
];

const doctorNav = [
  { to: "/doctor", label: "الرئيسية", icon: LayoutDashboard, end: true },
  { to: "/doctor/appointments", label: "المواعيد", icon: CalendarClock },
  { to: "/doctor/schedule", label: "أوقات العمل", icon: Clock },
  { to: "/doctor/patients", label: "مرضاي", icon: UsersIcon },
  { to: "/doctor/profile", label: "ملفي المهني", icon: Settings },
];

const adminNav = [
  { to: "/admin", label: "الرئيسية", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "المستخدمون", icon: Users },
  { to: "/admin/doctors", label: "الأطباء", icon: Stethoscope },
  { to: "/admin/specialties", label: "التخصصات", icon: ListTree },
  { to: "/admin/wilayas", label: "الولايات", icon: MapPin },
  { to: "/admin/reviews", label: "التقييمات", icon: Star },
];

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/doctors" element={<Doctors />} />
        <Route path="/doctors/:id" element={<DoctorProfile />} />
        <Route path="/specialties" element={<Specialties />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route element={<ProtectedRoute allow={["PATIENT"]} />}>
        <Route element={<DashboardLayout title="لوحة المريض" items={patientNav} />}>
          <Route path="/patient" element={<PatientDashboard />} />
          <Route path="/patient/appointments" element={<PatientAppointments />} />
          <Route path="/patient/notifications" element={<PatientNotifications />} />
          <Route path="/patient/profile" element={<PatientProfile />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allow={["DOCTOR"]} />}>
        <Route element={<DashboardLayout title="لوحة الطبيب" items={doctorNav} />}>
          <Route path="/doctor" element={<DoctorDashboard />} />
          <Route path="/doctor/appointments" element={<DoctorAppointments />} />
          <Route path="/doctor/schedule" element={<DoctorSchedule />} />
          <Route path="/doctor/patients" element={<DoctorPatients />} />
          <Route path="/doctor/profile" element={<DoctorProfileSettings />} />
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
        </Route>
      </Route>
    </Routes>
  );
}
