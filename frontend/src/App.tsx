import { Routes, Route, Navigate } from "react-router-dom";
import { PublicLayout } from "./components/layout/Layout";
import BookAppointment from "./pages/BookAppointment";
import AppointmentStatus from "./pages/AppointmentStatus";

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<BookAppointment />} />
        <Route path="/status/:id" element={<AppointmentStatus />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}