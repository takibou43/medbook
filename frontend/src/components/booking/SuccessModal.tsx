import { useEffect } from "react";
import { CalendarDays, CheckCircle2, MapPin } from "lucide-react";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { buildGoogleCalendarUrl } from "../../lib/booking";

export interface ConfirmedBooking {
  date: string;
  startTime: string;
  doctorName: string;
  address: string | null;
  patientName: string;
  clinicPhone: string | null;
  durationMinutes: number;
}

// شاشة النجاح الحالية (تفاصيل الموعد الفعلي + إضافة إلى Google Calendar) كما كانت،
// مع دور dialog وإغلاق بـ Escape لتحسين إمكانية الوصول.
export function SuccessModal({ booking, onClose }: { booking: ConfirmedBooking; onClose: () => void }) {
  const { showToast } = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
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
            التاريخ: {new Date(booking.date).toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <p className="text-slate-600">الساعة: {booking.startTime}</p>
        </div>
        {booking.address && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-slate-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {booking.address}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-500">أضف الموعد إلى تقويم هاتفك حتى لا تنساه</p>
          <a
            href={buildGoogleCalendarUrl({
              doctorName: booking.doctorName,
              patientName: booking.patientName,
              clinicPhone: booking.clinicPhone,
              address: booking.address,
              dateStr: booking.date,
              startTime: booking.startTime,
              durationMinutes: booking.durationMinutes,
            })}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => showToast("تم فتح Google Calendar لإضافة الموعد ✅", "success")}
            className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" /> إضافة إلى Google Calendar
          </a>
        </div>

        <Button variant="outline" className="mt-4 min-h-[44px] w-full" onClick={onClose} autoFocus>
          لاحقًا
        </Button>
      </div>
    </div>
  );
}
