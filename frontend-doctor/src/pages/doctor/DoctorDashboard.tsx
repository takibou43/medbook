import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarCheck, CalendarDays, Users, CheckCircle2, XCircle, Star, QrCode, Copy, Printer, AlertTriangle, Wallet } from "lucide-react";
import { api } from "../../lib/api";
import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/ui/States";
import { VerificationBadge } from "../../components/ui/Badge";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";

// رابط موقع الحجز الخاص بالمرضى — يُستخدم لبناء رابط/رمز QR خاص بكل طبيب.
// TODO: تحويله إلى متغيّر بيئة عند اعتماد نطاق مخصص للموقع مستقبلًا.
const PATIENT_SITE_URL = "https://medbook-alpha.vercel.app";

export default function DoctorDashboard() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["doctor-dashboard"],
    queryFn: async () => (await api.get("/doctor/dashboard")).data.data,
    // تحديث تلقائي للأرقام دون إعادة تحميل الصفحة (يتوقف عندما يكون التبويب في الخلفية).
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <Spinner />;

  const doctorId = user?.doctor?.id;
  const bookingUrl = doctorId ? `${PATIENT_SITE_URL}/?doctor=${doctorId}` : null;
  const qrImageUrl = bookingUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(bookingUrl)}`
    : null;

  async function copyBookingLink() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      showToast("تم نسخ رابط الحجز.", "success");
    } catch {
      showToast("تعذّر نسخ الرابط.", "error");
    }
  }

  function printQrCode() {
    if (!qrImageUrl) return;
    const doctorName = user?.doctor ? "د. " + user.doctor.firstName + " " + user.doctor.lastName : "";
    const printWindow = window.open("", "_blank", "width=480,height=640");
    if (!printWindow) {
      showToast("يرجى السماح بالنوافذ المنبثقة للطباعة.", "error");
      return;
    }
    const html =
      "<!DOCTYPE html><html dir='rtl' lang='ar'><head><meta charset='utf-8' />" +
      "<title>رمز QR للحجز</title><style>" +
      "*{box-sizing:border-box;}" +
      "body{font-family:Tahoma,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:32px;text-align:center;}" +
      "h1{font-size:20px;margin:0 0 4px;}" +
      "p.sub{color:#555;margin:0 0 24px;font-size:14px;}" +
      "img{width:320px;height:320px;border:1px solid #e2e8f0;border-radius:16px;padding:12px;}" +
      "p.instructions{margin-top:24px;font-size:14px;color:#333;max-width:320px;line-height:1.6;}" +
      ".brand{margin-top:32px;font-size:12px;color:#999;}" +
      "@media print{body{padding:0;}}" +
      "</style></head><body>" +
      "<h1>MedBook" + (doctorName ? " — " + doctorName : "") + "</h1>" +
      "<p class='sub'>امسح الرمز لحجز موعد</p>" +
      "<img src='" + qrImageUrl + "' alt='QR' />" +
      "<p class='instructions'>افتح كاميرا هاتفك ووجّهها نحو الرمز، ثم اضغط على الرابط الذي يظهر لحجز موعدك مباشرة.</p>" +
      "<p class='brand'>MedBook</p>" +
      "</body></html>";
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-slate-900">لوحة تحكم الطبيب</h1>
        {stats && <VerificationBadge status={stats.verificationStatus} />}
      </div>

      {stats?.verificationStatus === "PENDING" && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ملفك المهني قيد المراجعة من طرف الإدارة. لن تظهر في نتائج بحث المرضى حتى تتم الموافقة.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="مواعيد اليوم" value={stats?.todayAppointments ?? 0} icon={CalendarClock} />
        <StatCard label="المواعيد القادمة" value={stats?.upcomingAppointments ?? 0} icon={CalendarCheck} />
        <StatCard label="إجمالي المرضى" value={stats?.totalPatients ?? 0} icon={Users} />
        <StatCard label="المواعيد المكتملة" value={stats?.completedAppointments ?? 0} icon={CheckCircle2} tone="green" />
        <StatCard label="المواعيد الملغاة" value={stats?.cancelledAppointments ?? 0} icon={XCircle} tone="red" />
        <StatCard label="متوسط التقييم" value={`${(stats?.avgRating ?? 0).toFixed(1)} (${stats?.reviewsCount ?? 0})`} icon={Star} tone="amber" />
        <StatCard label="مواعيد هذا الشهر" value={stats?.monthlyAppointments ?? 0} icon={CalendarDays} />
        <StatCard label="نسبة الغياب" value={`${stats?.noShowRate ?? 0}%`} icon={AlertTriangle} tone={((stats?.noShowRate ?? 0) > 20) ? "red" : "amber"} />
        <StatCard label="الدخل التقديري" value={`${(stats?.estimatedRevenue ?? 0).toLocaleString("ar-DZ")} دج`} icon={Wallet} tone="green" />
      </div>

      {qrImageUrl && (
        <div className="card flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:items-center sm:text-right">
          <img src={qrImageUrl} alt="رمز QR للحجز" className="h-40 w-40 shrink-0 rounded-xl border border-slate-200 bg-white p-2" />
          <div className="flex-1 space-y-2">
            <p className="flex items-center justify-center gap-1.5 font-bold text-slate-800 sm:justify-start">
              <QrCode className="h-4 w-4" /> رمز QR الخاص بك
            </p>
            <p className="text-sm text-slate-500">
              اطبع هذا الرمز وضعه في عيادتك — يفتح المريض كاميرا هاتفه، يمسح الرمز، فيُختار اسمك تلقائيًا في صفحة الحجز ويكتب
              بياناته مباشرة دون بحث.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <button
                type="button"
                onClick={copyBookingLink}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-primary-300"
              >
                <Copy className="h-3.5 w-3.5" /> نسخ رابط الحجز
              </button>
              <button
                type="button"
                onClick={printQrCode}
                className="flex items-center gap-1.5 rounded-xl border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:border-primary-300"
              >
                <Printer className="h-3.5 w-3.5" /> طباعة الرمز
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
