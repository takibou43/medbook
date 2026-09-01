import { Routes, Route, Navigate } from "react-router-dom";
import { PublicLayout } from "./components/layout/Layout";
import BookAppointment from "./pages/BookAppointment";

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<BookAppointment />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
