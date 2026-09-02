import { Routes, Route, Navigate } from "react-router-dom";
import { PublicLayout } from "./components/layout/Layout";
import BookAppointment from "./pages/BookAppointment";
import TrackBooking from "./pages/TrackBooking";

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<BookAppointment />} />
        <Route path="/track" element={<TrackBooking />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
