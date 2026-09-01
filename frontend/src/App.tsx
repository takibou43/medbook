import { Routes, Route } from "react-router-dom";
import { LayoutDashboard, Users, Stethoscope, ListTree, MapPin, Star } from "lucide-react";

import { PublicLayout } from "./components/layout/Layout";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { ProtectedRoute } from "./routes/ProtectedRoute";

import Home from "./pages/Home";
import Doctors from "./pages/Doctors";
import DoctorProfile from "./pages/DoctorProfile";
import Specialties from "./pages/Specialties";
import HowItWorks from "./pages/HowItWorks";
import BookAppointment from "./pages/BookAppointment";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";

import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminDoctors from "./pages/admin/AdminDoctors";
import AdminSpecialties from "./pages/admin/AdminSpecialties";
import AdminWilayas from "./pages/admin/AdminWilayas";
import AdminReviews from "./pages/admin/AdminReviews";

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
        <Route path="/book" element={<BookAppointment />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
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
