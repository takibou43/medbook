import { useLanguage } from "./i18n/LanguageRoot";
import { t } from "./i18n/locale.ts";
import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useToast } from "./components/ui/Toast";
import { installAppointmentAlarm } from "./lib/appointmentAlarm";
import { PublicLayout } from "./components/layout/Layout";
import BookAppointment from "./pages/BookAppointment";
import AppointmentStatus from "./pages/AppointmentStatus";
import AccountAuth from "./pages/account/AccountAuth";
import MyAccount from "./pages/account/MyAccount";
import Clinics from "./pages/Clinics";
import FamilyMembers from "./pages/account/FamilyMembers";
import TreatmentPlans from "./pages/account/TreatmentPlans";

export default function App() {
  useLanguage();
  const { showToast } = useToast();
  // تنبيه «بعد 5 دقائق» والتطبيق مفتوح: رنة المنبّه الخاصة مرة واحدة + رسالة داخل الصفحة.
  useEffect(() => installAppointmentAlarm((msg) => showToast(msg.title || (msg.kind === "QUEUE_APPROACH_ALARM" ? t("دورك اقترب") : t("موعدك مع الطبيب بعد 5 دقائق")), "info")), [showToast]);

  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<BookAppointment />} />
        <Route path="/clinics" element={<Clinics />} />
        <Route path="/clinics/:id" element={<Clinics />} />
        <Route path="/status/:id" element={<AppointmentStatus />} />
        {/* حساب المريض (اختياري) — الحجز كضيف على "/" يبقى كما هو */}
        <Route path="/account/login" element={<AccountAuth />} />
        <Route path="/account" element={<MyAccount />} />
        <Route path="/account/family" element={<FamilyMembers />} />
        <Route path="/account/treatment-plans" element={<TreatmentPlans />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
