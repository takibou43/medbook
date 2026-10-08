import { ReactNode, useEffect } from "react";
import { CheckCircle2, MapPin } from "lucide-react";
import { Button } from "../ui/Button";
import { arabicDate } from "../../lib/patientPresentation";
import { useDialogFocus } from "./useDialogFocus";

export interface ConfirmedBooking {
  date: string;
  startTime: string;
  doctorName: string;
  address: string | null;
}

// تفاصيل الموعد الفعلي، مع التذكيرات عبر الإشعارات.
// مع دور dialog وإغلاق بـ Escape لتحسين إمكانية الوصول.
// extra: محتوى إضافي اختياري (مثل بطاقة «ذكّرني بموعدي» للمريض المسجّل) — الضيف لا يرى أي تغيير.
export function SuccessModal({ booking, onClose, extra }: { booking: ConfirmedBooking; onClose: () => void; extra?: ReactNode }) {
  const dialogRef = useDialogFocus(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-success-title"
        className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" aria-hidden="true" />
        <h2 id="booking-success-title" className="text-lg font-extrabold text-slate-900">
          تم حجز موعدك بنجاح ✅
        </h2>
        <div className="mt-3 space-y-1">
          <p className="font-semibold text-slate-700">الدكتور: {booking.doctorName}</p>
          <p className="text-slate-600">
            التاريخ: {arabicDate(booking.date)}
          </p>
          <p className="text-slate-600">الساعة: {booking.startTime}</p>
        </div>
        {booking.address && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-slate-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {booking.address}
          </p>
        )}

        {extra}

        <Button variant="outline" className="mt-4 min-h-[44px] w-full" onClick={onClose} autoFocus>
          لاحقًا
        </Button>
      </div>
    </div>
  );
}
