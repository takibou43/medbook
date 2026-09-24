import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useToast } from "./components/ui/Toast";
import { installAppointmentAlarm } from "./lib/appointmentAlarm";
import { PublicLayout } from "./components/layout/Layout";
import BookAppointment from "./pages/BookAppointment";
import AppointmentStatus from "./pages/AppointmentStatus";
import AccountAuth from "./pages/account/AccountAuth";
import MyAccount from "./pages/account/MyAccount";

export default function App() {
  const { showToast } = useToast();
  // تنبيه «بعد 5 دقائق» والتطبيق مفتوح: رنة المنبّه الخاصة مرة واحدة + رسالة داخل الصفحة.
  useEffect(() => installAppointmentAlarm((msg) => showToast(msg.title || "موعدك مع الطبيب بعد 5 دقائق", "info")), [showToast]);

  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<BookAppointment />} />
        <Route path="/status/:id" element={<AppointmentStatus />} />
        {/* حساب المريض (اختياري) — الحجز كضيف على "/" يبقى كما هو */}
        <Route path="/account/login" element={<AccountAuth />} />
        <Route path="/account" element={<MyAccount />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
