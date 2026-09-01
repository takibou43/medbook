import { Routes, Route } from "react-router-dom";
import { LayoutDashboard, CalendarClock, Clock, Users as UsersIcon, Settings } from "lucide-react";

import { DashboardLayout } from "./components/layout/DashboardLayout";
import { ProtectedRoute } from "./routes/ProtectedRoute";

import Login from "./pages/Login";
import DoctorDashboard from "./pages/doctor/DoctorDashboard";
import DoctorAppointments from "./pages/doctor/DoctorAppointments";
import DoctorSchedule from "./pages/doctor/DoctorSchedule";
import DoctorPatients from "./pages/doctor/DoctorPatients";
import DoctorProfileSettings from "./pages/doctor/DoctorProfileSettings";

const doctorNav = [
  { to: "/", label: "الرئيسية", icon: LayoutDashboard, end: true },
  { to: "/appointments", label: "المواعيد", icon: CalendarClock },
  { to: "/schedule", label: "أوقات العمل", icon: Clock },
  { to: "/patients", label: "مرضاي", icon: UsersIcon },
  { to: "/profile", label: "ملفي المهني", icon: Settings },
];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute allow={["DOCTOR"]} />}>
        <Route element={<DashboardLayout title="لوحة الطبيب" items={doctorNav} />}>
          <Route path="/" element={<DoctorDashboard />} />
          <Route path="/appointments" element={<DoctorAppointments />} />
          <Route path="/schedule" element={<DoctorSchedule />} />
          <Route path="/patients" element={<DoctorPatients />} />
          <Route path="/profile" element={<DoctorProfileSettings />} />
        </Route>
      </Route>

      <Route path="*" element={<Login />} />
    </Routes>
  );
}
